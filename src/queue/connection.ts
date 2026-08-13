import IORedis from "ioredis";

let sharedConnection: IORedis | undefined;

export function isQueueConfigured(): boolean {
  return Boolean(process.env.REDIS_URL?.trim());
}

/**
 * One shared ioredis connection per process, reused by both the BullMQ
 * Queue (producer, used from API route handlers) and Worker (consumer,
 * used from instrumentation.ts). BullMQ requires `maxRetriesPerRequest:
 * null` on connections handed to a Worker/QueueEvents.
 */
export function getQueueConnection(): IORedis {
  if (sharedConnection) return sharedConnection;
  const url = process.env.REDIS_URL?.trim();
  if (!url) throw new Error("REDIS_URL이 설정되지 않았습니다. 백그라운드 작업 큐를 사용할 수 없습니다.");
  sharedConnection = new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
  return sharedConnection;
}

/** Test-only teardown so `node:test` processes can exit cleanly instead of
 *  hanging on an open Redis socket. Never called from production code. */
export async function closeQueueConnection(): Promise<void> {
  if (!sharedConnection) return;
  await sharedConnection.quit();
  sharedConnection = undefined;
}
