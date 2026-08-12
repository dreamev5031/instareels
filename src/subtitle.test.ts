import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSubtitleSegments, saveSubtitleSettings } from "@/subtitle";
import { writeAssFile } from "@/subtitle/ass";
import { createDefaultCoverSettings, createDefaultSubtitleSettings, type Job, type TtsResult, STAGE_ORDER, SUBTITLE_EFFECTS } from "@/shared/types";
import { runTtsStage } from "@/tts";

function job(): Job {
  const stages = Object.fromEntries(STAGE_ORDER.map((stage) => [stage, { status: "PENDING" }])) as Job["stages"];
  stages.TTS = { status: "SUCCESS" };
  return {
    job_id: "JOB_SUBTITLE_TEST",
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), stages,
    cover: createDefaultCoverSettings(), subtitle: { status: "PENDING", settings: createDefaultSubtitleSettings(), segments: [] },
    ocr_enabled: false, sources: [], ocr: {}, clips: [], scenes: [], logs: [],
    tts: {
      status: "success", provider: "edge", voice: "ko-KR-SunHiNeural", file: "tts.mp3", audio_path: "tts.mp3",
      text: "첫 문장은 짧습니다. 두 번째 문장은 모바일에서 읽기 좋게 적절히 나뉘어야 합니다.", duration: 8,
      timing: { source: "duration_fallback", words: [] },
    },
  };
}

test("S1: subtitle segments are sentence-first, bounded, ordered and non-overlapping", () => {
  const segments = buildSubtitleSegments(job());
  assert.ok(segments.length >= 3);
  assert.equal(segments[0]!.start, 0);
  assert.equal(segments.at(-1)!.end, 8);
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    assert.ok(Array.from(segment.text).length <= 18);
    assert.ok(segment.end > segment.start);
    if (index) assert.ok(segments[index - 1]!.end <= segment.start);
  }
});

test("S2: every imported subtitle preset writes real ASS Dialogue events", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "instareels-ass-"));
  try {
    const source = job();
    const segments = buildSubtitleSegments(source);
    for (const effect of SUBTITLE_EFFECTS) {
      const file = path.join(root, `${effect}.ass`);
      const count = await writeAssFile(file, segments, { ...createDefaultSubtitleSettings(), effect });
      const content = await fs.readFile(file, "utf8");
      assert.ok(count > 0, effect);
      assert.match(content, /Dialogue:/, effect);
      assert.match(content, /PlayResX: 1080/, effect);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("S3: subtitle settings persist fixed segments before renderer runs", () => {
  const source = job();
  saveSubtitleSettings(source, { ...createDefaultSubtitleSettings(), effect: "word_zoom", vertical_position: "middle" });
  assert.equal(source.subtitle.status, "SUCCESS");
  assert.equal(source.subtitle.settings.effect, "word_zoom");
  assert.ok(source.subtitle.segments.length > 0);
});

test("S4: TTS stage accepts a provider-neutral audio/timing contract", async () => {
  const source = job();
  source.stages.TTS = { status: "PENDING" };
  source.tts = undefined;
  await runTtsStage(source, "공통 공급자 계약", "ko-KR-SunHiNeural", {
    provider: {
      name: "elevenlabs",
      async synthesize() {
        return { provider: "elevenlabs", audioPath: "eleven.wav", duration: 1.25, timing: { source: "provider_word", words: [{ text: "공통", start: 0, end: 0.5 }] } };
      },
    },
  });
  const result = source.tts as TtsResult | undefined;
  assert.equal(result?.provider, "elevenlabs");
  assert.equal(result?.audio_path, "eleven.wav");
  assert.equal(result?.timing.source, "provider_word");
});
