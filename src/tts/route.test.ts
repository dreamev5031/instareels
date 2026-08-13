import assert from "node:assert/strict";
import test from "node:test";
import { POST as ttsRequest } from "../../app/api/tts/route";
import { voiceStorage } from "@/voices/storage";
import type { ElevenLabsVoiceEntry } from "@/voices/storage";

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

test("provider=elevenlabs with an Edge voice shortName is rejected as TTS_PROVIDER_VOICE_MISMATCH, not routed to Edge", async () => {
  const res = await ttsRequest(
    new Request("http://localhost/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "안녕하세요", voice: "ko-KR-SunHiNeural", provider: "elevenlabs" }),
    }),
  );
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error_code, "TTS_PROVIDER_VOICE_MISMATCH");
  assert.equal(body.job.stages.TTS.status, "FAILED");
  assert.equal(body.job.tts, undefined);
});

test("provider=elevenlabs with an empty voiceId is rejected as ELEVENLABS_VOICE_REQUIRED", async () => {
  const res = await ttsRequest(
    new Request("http://localhost/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "안녕하세요", voice: "", provider: "elevenlabs" }),
    }),
  );
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error_code, "ELEVENLABS_VOICE_REQUIRED");
});

test("provider=edge with a registered ElevenLabs voiceId is rejected as TTS_PROVIDER_VOICE_MISMATCH, not routed to ElevenLabs", async () => {
  const fakeEntry: ElevenLabsVoiceEntry = {
    id: "internal-id-1",
    provider: "elevenlabs",
    voiceId: "21m00Tcm4TlvDq8ikWAM",
    alias: "쇼핑 여자 1",
    providerName: "Rachel",
    createdAt: new Date().toISOString(),
  };
  const original = voiceStorage.findByVoiceId.bind(voiceStorage);
  voiceStorage.findByVoiceId = async (voiceId: string) => (voiceId === fakeEntry.voiceId ? fakeEntry : undefined);
  try {
    const res = await ttsRequest(
      new Request("http://localhost/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "안녕하세요", voice: fakeEntry.voiceId, provider: "edge" }),
      }),
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error_code, "TTS_PROVIDER_VOICE_MISMATCH");
    assert.equal(body.job.stages.TTS.status, "FAILED");
    assert.equal(body.job.tts, undefined);
  } finally {
    voiceStorage.findByVoiceId = original;
  }
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
