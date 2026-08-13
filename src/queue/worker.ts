import { randomUUID } from "node:crypto";
import { Worker, UnrecoverableError, type Job as BullJob } from "bullmq";
import { loadJob, saveJob } from "@/jobs/store";
import { STAGE_ORDER, type ErrorCode, type Job, type JobError, type QueueKind, type StageName } from "@/shared/types";
import { runTtsStage } from "@/tts";
import { EdgeTTSProvider } from "@/tts/edgeTts";
import { ElevenLabsTTSProvider } from "@/tts/elevenlabs";
import { runAnalysisPipeline } from "@/jobs/pipeline";
import { runRenderStage } from "@/render";
import { getQueueConnection } from "./connection";
import { QUEUE_NAME, type QueueJobData } from "./jobQueue";
import { isRetryableErrorCode, queueMaxRetries } from "./retry";
import { notifyJobFailed, notifyRenderComplete } from "@/push/send";

const WORKER_ID = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;

function log(jobId: string, message: string) {
  // Deliberately prefixed and un-nested so `grep "\[JOB_"` isolates one
  // job's trace from the rest of the worker's (and the API's) log stream.
  console.log(`[${jobId}] ${message}`);
}

function currentRunningStage(job: Job): StageName | undefined {
  return STAGE_ORDER.find((stage) => job.stages[stage]?.status === "RUNNING");
}

async function markRunning(job: Job, attemptsMade: number) {
  job.queue = {
    kind: job.queue!.kind,
    status: "RUNNING",
    currentStage: job.queue!.kind === "render" ? "RENDER" : currentRunningStage(job) ?? job.queue!.currentStage,
    queuedAt: job.queue!.queuedAt,
    startedAt: new Date().toISOString(),
    workerId: WORKER_ID,
    retryCount: attemptsMade,
    maxRetries: job.queue!.maxRetries,
  };
  saveJob(job);
}

function markTerminal(job: Job, status: "COMPLETED" | "FAILED", error?: JobError) {
  job.queue = {
    ...job.queue!,
    status,
    completedAt: new Date().toISOString(),
    lastError: error,
  };
  saveJob(job);
}

async function processTts(job: Job, data: Extract<QueueJobData, { kind: "tts" }>) {
  const provider = data.provider === "elevenlabs" ? new ElevenLabsTTSProvider() : new EdgeTTSProvider();
  await runTtsStage(job, data.text, data.voice, { provider });
  if (data.provider === "elevenlabs" && job.tts && data.voiceAlias) job.tts.voice_alias = data.voiceAlias;
}

async function processAnalyze(job: Job, data: Extract<QueueJobData, { kind: "analyze" }>) {
  job.ocr_enabled = data.ocrEnabled;
  // runOcrStage/runClipStage/runAllocateStage/runValidateStage all call
  // failStage() then throw on error, so a rejection here always leaves
  // job.stages with a proper JobError the outer catch can read back via
  // jobErrorFromStages() — no separate error handling needed.
  await runAnalysisPipeline(job, (snapshot) => {
    job.queue!.currentStage = currentRunningStage(snapshot) ?? job.queue!.currentStage;
    saveJob(snapshot);
  });
}

async function processRender(job: Job) {
  await runRenderStage(job, (snapshot) => saveJob(snapshot));
}

/** Runs a push-notification call, persists whatever job.notification it
 *  sets (SUCCESS/SKIPPED/FAILED — see src/push/send.ts), and logs the
 *  outcome. Never throws: a push failure must never fail the JOB itself. */
async function sendAndLogNotification(job: Job, send: () => Promise<void>): Promise<void> {
  try {
    await send();
    saveJob(job);
    log(job.job_id, job.notification?.status === "SUCCESS" ? "PUSH SUCCESS" : `PUSH SKIPPED (${job.notification?.reason})`);
  } catch (pushError) {
    saveJob(job);
    log(job.job_id, `PUSH FAILED: ${pushError instanceof Error ? pushError.message : String(pushError)}`);
  }
}

const FALLBACK_STAGE: Record<QueueKind, StageName> = { tts: "TTS", analyze: "OCR", render: "RENDER" };
const FALLBACK_CODE: Record<QueueKind, ErrorCode> = { tts: "TTS_GENERATION_FAILED", analyze: "OCR_ENGINE_FAILED", render: "RENDER_OUTPUT_INVALID" };

function jobErrorFromStages(job: Job): JobError | undefined {
  const failedStage = STAGE_ORDER.find((stage) => job.stages[stage]?.status === "FAILED");
  return failedStage ? job.stages[failedStage]?.error : undefined;
}

async function processQueueJob(bullJob: BullJob<QueueJobData>): Promise<void> {
  const data = bullJob.data;
  const job = loadJob(data.jobId);
  if (!job.queue) {
    // Defensive: should always be set by the enqueueing route, but never
    // silently proceed with an undefined queue meta.
    job.queue = { kind: data.kind, status: "QUEUED", queuedAt: new Date().toISOString(), retryCount: 0, maxRetries: queueMaxRetries() };
  }

  log(data.jobId, `acquired by ${WORKER_ID} (attempt ${bullJob.attemptsMade + 1}/${1 + queueMaxRetries()})`);
  await markRunning(job, bullJob.attemptsMade);

  try {
    if (data.kind === "tts") await processTts(job, data);
    else if (data.kind === "analyze") await processAnalyze(job, data);
    else await processRender(job);

    markTerminal(job, "COMPLETED");
    log(data.jobId, `${data.kind.toUpperCase()} SUCCESS`);
    log(data.jobId, "JOB COMPLETED");

    if (data.kind === "render") {
      await sendAndLogNotification(job, () => notifyRenderComplete(job));
    }
  } catch (caught) {
    const jobError = jobErrorFromStages(job);
    const code = jobError?.error_code ?? (caught as { code?: string })?.code;
    const message = jobError?.message ?? (caught instanceof Error ? caught.message : String(caught));
    log(data.jobId, `${data.kind.toUpperCase()} FAILED: [${code ?? "UNKNOWN"}] ${message}`);

    const retryable = isRetryableErrorCode(code);
    const attemptsExhausted = bullJob.attemptsMade + 1 >= (bullJob.opts.attempts ?? 1);
    if (!retryable || attemptsExhausted) {
      markTerminal(job, "FAILED", jobError ?? {
        stage: FALLBACK_STAGE[data.kind],
        error_code: FALLBACK_CODE[data.kind],
        message,
        timestamp: new Date().toISOString(),
      });
      log(data.jobId, "JOB FAILED");
      await sendAndLogNotification(job, () => notifyJobFailed(job, data.kind));
      if (!retryable) throw new UnrecoverableError(message);
      throw caught;
    }

    // Retryable and attempts remain: let BullMQ's backoff schedule the next
    // attempt. job.queue.status stays "RUNNING" is wrong here — reflect the
    // pending retry so polling UIs don't show a false COMPLETED/FAILED.
    job.queue.status = "QUEUED";
    saveJob(job);
    log(data.jobId, `retrying (${bullJob.attemptsMade + 1}/${bullJob.opts.attempts ?? 1} attempts used)`);
    throw caught;
  }
}

let sharedWorker: Worker<QueueJobData> | undefined;

/** Starts the single in-process background worker. Call exactly once per
 *  process (see instrumentation.ts) — safe to call multiple times, only the
 *  first call takes effect. Runs independently of any HTTP request: once
 *  started, it keeps pulling jobs from Redis until the process exits, so a
 *  browser going away has no effect on jobs already queued or running. */
export function startWorker(): Worker<QueueJobData> {
  if (sharedWorker) return sharedWorker;
  const concurrency = Number(process.env.WORKER_CONCURRENCY) || 1;
  sharedWorker = new Worker<QueueJobData>(QUEUE_NAME, processQueueJob, {
    connection: getQueueConnection(),
    concurrency,
  });
  sharedWorker.on("error", (err) => console.error(`[worker] ${WORKER_ID} error:`, err));
  console.log(`[worker] ${WORKER_ID} started (concurrency=${concurrency})`);
  return sharedWorker;
}

/** Test-only teardown — see closeQueueConnection(). */
export async function stopWorker(): Promise<void> {
  if (!sharedWorker) return;
  await sharedWorker.close();
  sharedWorker = undefined;
}

export { WORKER_ID };
