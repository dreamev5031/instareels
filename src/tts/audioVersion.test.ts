import assert from "node:assert/strict";
import test from "node:test";
import { ttsAudioSrc, ttsAudioVersion } from "./audioVersion";
import type { TtsResult } from "@/shared/types";

function tts(overrides: Partial<TtsResult> = {}): TtsResult {
  return {
    status: "success",
    provider: "edge",
    text: "안녕하세요",
    voice: "ko-KR-SunHiNeural",
    file: "tts.mp3",
    audio_path: "tts.mp3",
    duration: 3.21,
    timing: { source: "duration_fallback", words: [] },
    ...overrides,
  };
}

test("no tts result yields an empty (but stable) version", () => {
  assert.equal(ttsAudioVersion(undefined), "");
});

test("switching provider changes the version even if voice/duration coincide", () => {
  const edge = ttsAudioVersion(tts({ provider: "edge", voice: "same", duration: 5 }));
  const eleven = ttsAudioVersion(tts({ provider: "elevenlabs", voice: "same", duration: 5 }));
  assert.notEqual(edge, eleven);
});

test("switching voice within the same provider changes the version", () => {
  const a = ttsAudioVersion(tts({ provider: "elevenlabs", voice: "voiceA", duration: 5 }));
  const b = ttsAudioVersion(tts({ provider: "elevenlabs", voice: "voiceB", duration: 5 }));
  assert.notEqual(a, b);
});

test("regenerating the same provider/voice but a different duration changes the version", () => {
  const first = ttsAudioVersion(tts({ duration: 3.21 }));
  const second = ttsAudioVersion(tts({ duration: 4.5 }));
  assert.notEqual(first, second);
});

test("identical provider/voice/duration reproduces the same version deterministically", () => {
  assert.equal(ttsAudioVersion(tts()), ttsAudioVersion(tts()));
});

test("ttsAudioSrc embeds a real cache-busting query param, never a bare unversioned URL", () => {
  const src = ttsAudioSrc("https://api.example.com", "JOB_000001", tts({ provider: "elevenlabs", voice: "v1", duration: 2 }));
  assert.equal(src, "https://api.example.com/api/media/JOB_000001/tts?v=elevenlabs%3Av1%3A2");

  const edgeSrc = ttsAudioSrc("https://api.example.com", "JOB_000001", tts({ provider: "edge", voice: "v1", duration: 2 }));
  assert.notEqual(src, edgeSrc);
});
