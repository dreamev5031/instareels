import { Queue } from "bullmq";
import type { QueueKind, TtsProviderName } from "@/shared/types";
import { getQueueConnection } from "./connection";
import { queueMaxRetries } from "./retry";

export const QUEUE_NAME = "instareels-jobs";

export interface TtsQueueJobData {
  kind: "tts";
  jobId: string;
  text: string;
  voice: string;
  provider: TtsProviderName;
  voiceAlias?: string;
}

export interface AnalyzeQueueJobData {
  kind: "analyze";
  jobId: string;
  ocrEnabled: boolean;
}

export interface RenderQueueJobData {
  kind: "render";
  jobId: string;
}

export type QueueJobData = TtsQueueJobData | AnalyzeQueueJobData | RenderQueueJobData;

let sharedQueue: Queue<QueueJobData> | undefined;

export function getJobQueue(): Queue<QueueJobData> {
  if (sharedQueue) return sharedQueue;
  sharedQueue = new Queue<QueueJobData>(QUEUE_NAME, { connection: getQueueConnection() });
  return sharedQueue;
}

/** Test-only teardown — see closeQueueConnection(). */
export async function closeJobQueue(): Promise<void> {
  if (!sharedQueue) return;
  await sharedQueue.close();
  sharedQueue = undefined;
}

/** Deterministic BullMQ job id per (kind, appJobId) — reusing it while a
 *  prior attempt is still queued/active makes BullMQ return the existing
 *  entry instead of creating a duplicate, which is the primary defense
 *  against double-processing the same JOB (belt-and-suspenders with the
 *  job.queue.status check the API routes also do before enqueueing).
 *  BullMQ rejects custom job ids containing ":" (reserved for its own Redis
 *  key namespacing), so "-" separates the parts instead. */
export function queueJobId(kind: QueueKind, appJobId: string): string {
  return `${kind}-${appJobId}`;
}

/** Returns the BullMQ job id actually used. Calling this twice in a row for
 *  the same (kind, jobId) while the first is still pending returns the SAME
 *  id both times — BullMQ coalesces the add() instead of creating a second
 *  entry — which is the deterministic half of the dedup guarantee (see
 *  isStageQueuedOrActive for the API-route-level half). */
export async function enqueueStage(data: QueueJobData): Promise<string> {
  const queue = getJobQueue();
  const job = await queue.add(data.kind, data, {
    jobId: queueJobId(data.kind, data.jobId),
    attempts: 1 + queueMaxRetries(),
    backoff: { type: "exponential", delay: 3000 },
    // Terminal BullMQ job records are removed once the worker finishes with
    // them (success or exhausted retries) — the durable status/history
    // lives in the JOB's own file (job.queue), not in Redis, so freeing the
    // jobId here just allows a legitimate future resubmission to reuse it.
    removeOnComplete: true,
    removeOnFail: true,
  });
  return job.id!;
}

/** True if a queue entry for this (kind, appJobId) is still queued/active —
 *  used by API routes to reject a resubmission with a clear error instead
 *  of silently coalescing into whatever BullMQ does with a duplicate jobId. */
export async function isStageQueuedOrActive(kind: QueueKind, appJobId: string): Promise<boolean> {
  const queue = getJobQueue();
  const job = await queue.getJob(queueJobId(kind, appJobId));
  if (!job) return false;
  const state = await job.getState();
  return state === "waiting" || state === "active" || state === "delayed" || state === "waiting-children";
}
