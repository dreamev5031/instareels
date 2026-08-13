import assert from "node:assert/strict";
import test from "node:test";
import { VoiceStorage } from "./storage";

test("an unconfigured registry (no bucket env vars) is a safe no-op, never throws", async () => {
  const storage = new VoiceStorage(undefined);
  assert.equal(storage.isConfigured(), false);
  assert.deepEqual(await storage.listVoices(), []);
  assert.equal(await storage.findById("anything"), undefined);
  assert.equal(await storage.findByVoiceId("21m00Tcm4TlvDq8ikWAM"), undefined);
});

test("addVoice rejects outright when the registry isn't configured (never silently drops a registration)", async () => {
  const storage = new VoiceStorage(undefined);
  await assert.rejects(storage.addVoice({ voiceId: "v1", alias: "테스트", providerName: "Test" }));
});

test("removeVoice on an empty/unconfigured registry reports not-found rather than throwing", async () => {
  const storage = new VoiceStorage(undefined);
  assert.equal(await storage.removeVoice("nonexistent"), false);
});
