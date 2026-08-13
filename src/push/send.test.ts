import assert from "node:assert/strict";
import test from "node:test";
import webpush from "web-push";
import { notifyJobFailed, notifyRenderComplete, isPushConfigured, jobPageUrl } from "./send";
import { pushSubscriptionStorage } from "./storage";
import type { Job } from "@/shared/types";

// A real (test-only) VAPID keypair — web-push validates key shape/length
// strictly, so a placeholder string like "pub" fails before ever reaching
// the network-mocked sendNotification call.
const TEST_VAPID = webpush.generateVAPIDKeys();

function fakeJob(): Job {
  return {
    job_id: "JOB_PUSH_TEST",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    stages: {} as Job["stages"],
    cover: {} as Job["cover"],
    subtitle: { status: "PENDING", settings: {} as Job["subtitle"]["settings"], segments: [] },
    bgm: { bgmEnabled: false, bgmVolume: 0.18 },
    ocr_enabled: false,
    ad_label_enabled: true,
    sources: [],
    ocr: {},
    clips: [],
    scenes: [],
    logs: [],
  };
}

function withEnv(vars: Record<string, string | undefined>, run: () => Promise<void>): Promise<void> {
  const original: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) original[key] = process.env[key];
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return run().finally(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("isPushConfigured is false unless all three VAPID env vars are set", () =>
  withEnv({ WEB_PUSH_VAPID_PUBLIC_KEY: undefined, WEB_PUSH_VAPID_PRIVATE_KEY: undefined, WEB_PUSH_SUBJECT: undefined }, async () => {
    assert.equal(isPushConfigured(), false);
  }));

test("jobPageUrl uses the first FRONTEND_URL entry as the base", () =>
  withEnv({ FRONTEND_URL: "https://instareels-web.up.railway.app,https://other.example" }, async () => {
    assert.equal(jobPageUrl("JOB_000123"), "https://instareels-web.up.railway.app/job/JOB_000123");
  }));

test("notify() records SKIPPED with reason NOT_CONFIGURED when VAPID env vars are absent — never throws", () =>
  withEnv({ WEB_PUSH_VAPID_PUBLIC_KEY: undefined, WEB_PUSH_VAPID_PRIVATE_KEY: undefined, WEB_PUSH_SUBJECT: undefined }, async () => {
    const job = fakeJob();
    await notifyRenderComplete(job);
    assert.equal(job.notification?.status, "SKIPPED");
    assert.equal(job.notification?.reason, "NOT_CONFIGURED");
  }));

test("notify() records SKIPPED with reason NO_SUBSCRIPTIONS when configured but nobody is subscribed", () =>
  withEnv({ WEB_PUSH_VAPID_PUBLIC_KEY: TEST_VAPID.publicKey, WEB_PUSH_VAPID_PRIVATE_KEY: TEST_VAPID.privateKey, WEB_PUSH_SUBJECT: "mailto:test@example.com" }, async () => {
    const originalList = pushSubscriptionStorage.listSubscriptions.bind(pushSubscriptionStorage);
    pushSubscriptionStorage.listSubscriptions = async () => [];
    try {
      const job = fakeJob();
      await notifyJobFailed(job, "render");
      assert.equal(job.notification?.status, "SKIPPED");
      assert.equal(job.notification?.reason, "NO_SUBSCRIPTIONS");
    } finally {
      pushSubscriptionStorage.listSubscriptions = originalList;
    }
  }));

test("notify() sends to every subscription and records SUCCESS when at least one send works", () =>
  withEnv({ WEB_PUSH_VAPID_PUBLIC_KEY: TEST_VAPID.publicKey, WEB_PUSH_VAPID_PRIVATE_KEY: TEST_VAPID.privateKey, WEB_PUSH_SUBJECT: "mailto:test@example.com" }, async () => {
    const originalList = pushSubscriptionStorage.listSubscriptions.bind(pushSubscriptionStorage);
    const originalSend = webpush.sendNotification;
    const sent: unknown[] = [];
    pushSubscriptionStorage.listSubscriptions = async () => [
      { id: "s1", endpoint: "https://push.example/1", p256dh: "p1", auth: "a1", deviceId: "d1", createdAt: "" },
      { id: "s2", endpoint: "https://push.example/2", p256dh: "p2", auth: "a2", deviceId: "d2", createdAt: "" },
    ];
    // @ts-expect-error test stub — signature doesn't need to match exactly
    webpush.sendNotification = async (subscription: { endpoint: string }, payload: string) => {
      sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) });
      return { statusCode: 201 };
    };
    try {
      const job = fakeJob();
      await notifyRenderComplete(job);
      assert.equal(job.notification?.status, "SUCCESS");
      assert.equal(sent.length, 2);
      assert.equal((sent[0] as { payload: { title: string } }).payload.title, "릴스 영상 완성");
    } finally {
      pushSubscriptionStorage.listSubscriptions = originalList;
      webpush.sendNotification = originalSend;
    }
  }));

test("a dead subscription (410 Gone) is pruned from storage and does not block delivery to the rest", () =>
  withEnv({ WEB_PUSH_VAPID_PUBLIC_KEY: TEST_VAPID.publicKey, WEB_PUSH_VAPID_PRIVATE_KEY: TEST_VAPID.privateKey, WEB_PUSH_SUBJECT: "mailto:test@example.com" }, async () => {
    const originalList = pushSubscriptionStorage.listSubscriptions.bind(pushSubscriptionStorage);
    const originalRemove = pushSubscriptionStorage.removeSubscriptionSilently.bind(pushSubscriptionStorage);
    const originalSend = webpush.sendNotification;
    const removed: string[] = [];
    pushSubscriptionStorage.listSubscriptions = async () => [
      { id: "dead", endpoint: "https://push.example/dead", p256dh: "p1", auth: "a1", deviceId: "d1", createdAt: "" },
      { id: "alive", endpoint: "https://push.example/alive", p256dh: "p2", auth: "a2", deviceId: "d2", createdAt: "" },
    ];
    pushSubscriptionStorage.removeSubscriptionSilently = async (endpoint: string) => {
      removed.push(endpoint);
    };
    // @ts-expect-error test stub
    webpush.sendNotification = async (subscription: { endpoint: string }) => {
      if (subscription.endpoint.endsWith("/dead")) {
        const err = Object.assign(new Error("Gone"), { statusCode: 410 });
        throw err;
      }
      return { statusCode: 201 };
    };
    try {
      const job = fakeJob();
      await notifyRenderComplete(job);
      assert.equal(job.notification?.status, "SUCCESS", "the alive subscription still got the push");
      assert.deepEqual(removed, ["https://push.example/dead"]);
    } finally {
      pushSubscriptionStorage.listSubscriptions = originalList;
      pushSubscriptionStorage.removeSubscriptionSilently = originalRemove;
      webpush.sendNotification = originalSend;
    }
  }));

test("when every send fails, notify() records FAILED and rethrows (worker logs PUSH FAILED, job.queue.status is untouched)", () =>
  withEnv({ WEB_PUSH_VAPID_PUBLIC_KEY: TEST_VAPID.publicKey, WEB_PUSH_VAPID_PRIVATE_KEY: TEST_VAPID.privateKey, WEB_PUSH_SUBJECT: "mailto:test@example.com" }, async () => {
    const originalList = pushSubscriptionStorage.listSubscriptions.bind(pushSubscriptionStorage);
    const originalSend = webpush.sendNotification;
    pushSubscriptionStorage.listSubscriptions = async () => [
      { id: "s1", endpoint: "https://push.example/1", p256dh: "p1", auth: "a1", deviceId: "d1", createdAt: "" },
    ];
    webpush.sendNotification = async () => {
      throw new Error("network down");
    };
    try {
      const job = fakeJob();
      job.queue = { kind: "render", status: "COMPLETED", queuedAt: "", retryCount: 0, maxRetries: 2 };
      await assert.rejects(notifyRenderComplete(job));
      assert.equal(job.notification?.status, "FAILED");
      assert.equal(job.queue.status, "COMPLETED", "a push failure must never change the job's own success/fail status");
    } finally {
      pushSubscriptionStorage.listSubscriptions = originalList;
      webpush.sendNotification = originalSend;
    }
  }));
