import assert from "node:assert/strict";
import test from "node:test";
import { POST as ttsRequest } from "../../app/api/tts/route";

test("ElevenLabs TTS request for an unregistered voice fails as VOICE_NOT_FOUND, never silently falls back to Edge", async () => {
  const res = await ttsRequest(
    new Request("http://localhost/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "안녕하세요", voice: "21m00Tcm4TlvDq8ikWAM", provider: "elevenlabs" }),
    }),
  );
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error_code, "VOICE_NOT_FOUND");
  assert.equal(body.job.stages.TTS.status, "FAILED");
  assert.equal(body.job.stages.TTS.error?.error_code, "VOICE_NOT_FOUND");
  assert.equal(body.job.tts, undefined);
});

test("malformed JSON body is rejected before any job is touched", async () => {
  const res = await ttsRequest(
    new Request("http://localhost/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    }),
  );
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, "INVALID_BODY");
});
