import assert from "node:assert/strict";
import test from "node:test";
import { PushSubscriptionStorage } from "./storage";

test("an unconfigured registry (no bucket env vars) is a safe no-op, never throws", async () => {
  const storage = new PushSubscriptionStorage(undefined);
  assert.equal(storage.isConfigured(), false);
  assert.deepEqual(await storage.listSubscriptions(), []);
});

test("addSubscription rejects outright when the registry isn't configured (never silently drops a subscription)", async () => {
  const storage = new PushSubscriptionStorage(undefined);
  await assert.rejects(storage.addSubscription({ endpoint: "https://push.example/abc", p256dh: "p", auth: "a", deviceId: "d1" }));
});

test("removeSubscription on an empty/unconfigured registry reports not-found rather than throwing", async () => {
  const storage = new PushSubscriptionStorage(undefined);
  assert.equal(await storage.removeSubscription("https://push.example/abc"), false);
});

test("removeSubscriptionSilently never throws even when storage is unconfigured", async () => {
  const storage = new PushSubscriptionStorage(undefined);
  await storage.removeSubscriptionSilently("https://push.example/abc");
});
