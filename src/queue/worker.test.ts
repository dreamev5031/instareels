import assert from "node:assert/strict";
import test from "node:test";
import { createJob, loadJob, saveJob } from "@/jobs/store";
import type { Job, SourceVideo } from "@/shared/types";
import { enqueueStage, isStageQueuedOrActive, closeJobQueue } from "@/queue/jobQueue";
import { startWorker, stopWorker } from "@/queue/worker";
import { closeQueueConnection } from "@/queue/connection";
import { queueMaxRetries } from "@/queue/retry";

// These tests exercise the REAL BullMQ Queue + Worker against a real local
// Redis (REDIS_URL must point at one — see package.json's "test" script /
// CI setup). They call the actual production processQueueJob via
// startWorker(), not a mock, so a green run here means the queue mechanics
// (enqueue, dedup, retry limiting, terminal state) work end-to-end, not
// just in isolated unit tests.
const REDIS_AVAILABLE = Boolean(process.env.REDIS_URL?.trim());

function addSafeSource(job: Job, sourceId: string, duration: number): void {
  const source: SourceVideo = {
    source_id: sourceId,
    original_filename: `${sourceId}.mp4`,
    file: `${sourceId}.mp4`,
    duration,
    width: 1080,
    height: 1920,
    fps: 30,
    status: "ANALYZED",
  };
  job.sources.push(source);
  job.ocr[sourceId] = [{ start: 0, end: duration, ocr_safe: true, confidence: 99 }];
}

function withTts(job: Job, duration: number): void {
  job.stages.TTS = { status: "SUCCESS" };
  job.tts = {
    status: "success",
    provider: "edge",
    text: "테스트 나레이션",
    voice: "ko-KR-SunHiNeural",
    file: "tts.mp3",
    audio_path: "tts.mp3",
    duration,
    timing: { source: "duration_fallback", words: [] },
  };
}

async function waitForTerminal(jobId: string, timeoutMs = 20000): Promise<Job> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = loadJob(jobId);
    if (job.queue?.status === "COMPLETED" || job.queue?.status === "FAILED") return job;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${jobId} to reach a terminal queue status`);
}

test("analyze queue job runs end-to-end through real Redis + the production worker", { skip: !REDIS_AVAILABLE && "REDIS_URL not set" }, async () => {
  startWorker();
  const job = createJob();
  withTts(job, 3);
  addSafeSource(job, "SOURCE_001", 6);
  job.queue = { kind: "analyze", status: "QUEUED", queuedAt: new Date().toISOString(), retryCount: 0, maxRetries: queueMaxRetries() };
  saveJob(job);

  await enqueueStage({ kind: "analyze", jobId: job.job_id, ocrEnabled: false });
  const finished = await waitForTerminal(job.job_id);

  assert.equal(finished.queue?.status, "COMPLETED");
  assert.equal(finished.stages.VALIDATE.status, "SUCCESS");
  assert.equal(finished.validation?.status, "PASS");
  assert.equal(finished.queue?.workerId?.startsWith("worker-"), true);
});

test("a permanent error (insufficient duration) fails on the first attempt, never retries", { skip: !REDIS_AVAILABLE && "REDIS_URL not set" }, async () => {
  startWorker();
  const job = createJob();
  withTts(job, 30); // needs 30s of SAFE footage
  addSafeSource(job, "SOURCE_001", 2); // only 2s available — INSUFFICIENT_TOTAL_DURATION, not retryable
  job.queue = { kind: "analyze", status: "QUEUED", queuedAt: new Date().toISOString(), retryCount: 0, maxRetries: queueMaxRetries() };
  saveJob(job);

  await enqueueStage({ kind: "analyze", jobId: job.job_id, ocrEnabled: false });
  const finished = await waitForTerminal(job.job_id);

  assert.equal(finished.queue?.status, "FAILED");
  assert.equal(finished.queue?.retryCount, 0, "must fail on the very first attempt, not after retries");
  assert.equal(finished.queue?.lastError?.error_code, "INSUFFICIENT_TOTAL_DURATION");
  // Push isn't configured in this test environment — must be recorded as
  // SKIPPED, and the job's own success/fail status must be unaffected by that.
  assert.equal(finished.notification?.status, "SKIPPED");
  assert.equal(finished.notification?.reason, "NOT_CONFIGURED");
});

test("two concurrent submissions for the same JOB coalesce into a single BullMQ entry, never two", { skip: !REDIS_AVAILABLE && "REDIS_URL not set" }, async () => {
  const job = createJob();
  withTts(job, 3);
  addSafeSource(job, "SOURCE_001", 6);
  job.queue = { kind: "analyze", status: "QUEUED", queuedAt: new Date().toISOString(), retryCount: 0, maxRetries: queueMaxRetries() };
  saveJob(job);

  // Fired concurrently (not awaited one after another) so both add() calls
  // race each other, not the worker — this is the deterministic half of
  // the "same JOB never processed twice" guarantee (see jobQueue.ts).
  const [firstId, secondId] = await Promise.all([
    enqueueStage({ kind: "analyze", jobId: job.job_id, ocrEnabled: false }),
    enqueueStage({ kind: "analyze", jobId: job.job_id, ocrEnabled: false }),
  ]);
  assert.equal(firstId, secondId, "BullMQ must coalesce both adds into the same job id, not create a duplicate");

  startWorker();
  await waitForTerminal(job.job_id);
  assert.equal(await isStageQueuedOrActive("analyze", job.job_id), false, "the BullMQ record is freed once terminal (removeOnComplete/removeOnFail)");
});

test.after(async () => {
  await stopWorker();
  await closeJobQueue();
  await closeQueueConnection();
});
