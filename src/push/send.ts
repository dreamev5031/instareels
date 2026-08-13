import webpush from "web-push";
import type { Job, QueueKind } from "@/shared/types";
import { pushSubscriptionStorage } from "./storage";

export function isPushConfigured(): boolean {
  return Boolean(
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() &&
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim() &&
    process.env.WEB_PUSH_SUBJECT?.trim(),
  );
}

let vapidConfigured = false;
function ensureVapidConfigured() {
  if (vapidConfigured) return;
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.WEB_PUSH_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) throw new Error("PUSH_NOT_CONFIGURED");
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
}

function frontendBaseUrl(): string {
  const first = (process.env.FRONTEND_URL ?? "").split(",")[0]?.trim();
  return first || "";
}

export function jobPageUrl(jobId: string): string {
  const base = frontendBaseUrl();
  return base ? `${base}/job/${jobId}` : `/job/${jobId}`;
}

interface NotificationPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

type BroadcastResult = "SENT" | "NOT_CONFIGURED" | "NO_SUBSCRIPTIONS";

/** Sends to every registered subscription; a single dead endpoint (410/404)
 *  is pruned and does not stop delivery to the rest. "Not configured" and
 *  "no subscriptions" are ordinary, expected states (push is opt-in), so
 *  they're reported as a result value, not an exception — only a genuine
 *  send failure throws. */
async function broadcast(payload: NotificationPayload): Promise<BroadcastResult> {
  if (!isPushConfigured()) return "NOT_CONFIGURED";
  ensureVapidConfigured();
  const subscriptions = await pushSubscriptionStorage.listSubscriptions();
  if (subscriptions.length === 0) return "NO_SUBSCRIPTIONS";

  const results = await Promise.allSettled(
    subscriptions.map((subscription) =>
      webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        JSON.stringify(payload),
      ).catch(async (error) => {
        const statusCode = (error as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await pushSubscriptionStorage.removeSubscriptionSilently(subscription.endpoint);
        }
        throw error;
      }),
    ),
  );
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failures.length === results.length) {
    throw new Error(`모든 push 발송 실패 (${failures.length}건): ${failures[0]?.reason}`);
  }
  return "SENT";
}

// job.notification is set here (not just logged) so a push outcome is
// visible in the persisted JOB itself — see JobNotificationState. Never
// affects job.queue.status: that's set by the worker before this is called
// and this function does not touch it either way.
async function notify(job: Job, payload: NotificationPayload): Promise<void> {
  try {
    const result = await broadcast(payload);
    job.notification =
      result === "SENT"
        ? { status: "SUCCESS", sentAt: new Date().toISOString() }
        : { status: "SKIPPED", reason: result };
  } catch (caught) {
    job.notification = { status: "FAILED", reason: caught instanceof Error ? caught.message : String(caught) };
    throw caught;
  }
}

export async function notifyRenderComplete(job: Job): Promise<void> {
  await notify(job, {
    title: "릴스 영상 완성",
    body: "영상 생성이 완료되었습니다.",
    url: jobPageUrl(job.job_id),
    tag: `job-${job.job_id}`,
  });
}

export async function notifyJobFailed(job: Job, kind: QueueKind): Promise<void> {
  const stageLabel: Record<QueueKind, string> = {
    tts: "TTS 생성",
    analyze: "영상 구성",
    render: "영상 렌더",
  };
  await notify(job, {
    title: "영상 생성 실패",
    body: `${stageLabel[kind]} 단계에서 문제가 발생했습니다.`,
    url: jobPageUrl(job.job_id),
    tag: `job-${job.job_id}`,
  });
}
