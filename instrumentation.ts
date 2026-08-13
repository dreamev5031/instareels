// Boots the in-process background job worker exactly once when the Node.js
// server starts (production `next start` or `next dev`) — see
// src/queue/worker.ts for why this runs in-process rather than as a
// separate Railway service (Railway Volumes are 1:1 with a service, and
// this pipeline's stage functions read/write job files on local disk).
//
// Gated on REDIS_URL being set: only the instareels-api deployment has it
// configured, so instareels-web (which has no ffmpeg and never receives
// job-processing traffic) and local `next dev` without Redis never try to
// start a worker they can't run.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.REDIS_URL?.trim()) return;
  const { startWorker } = await import("@/queue/worker");
  startWorker();
}
