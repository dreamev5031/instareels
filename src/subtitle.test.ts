import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSubtitleSegments, saveSubtitleSettings } from "@/subtitle";
import { writeAssFile } from "@/subtitle/ass";
import { createDefaultBgmSettings, createDefaultCoverSettings, createDefaultSubtitleSettings, type Job, type TtsResult, STAGE_ORDER, SUBTITLE_EFFECTS } from "@/shared/types";
import { runTtsStage } from "@/tts";
import { layoutSubtitleText, subtitleMaxCharsPerLine, subtitleMaxSegmentChars } from "@/subtitle/spec";

function job(): Job {
  const stages = Object.fromEntries(STAGE_ORDER.map((stage) => [stage, { status: "PENDING" }])) as Job["stages"];
  stages.TTS = { status: "SUCCESS" };
  return {
    job_id: "JOB_SUBTITLE_TEST",
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), stages,
    cover: createDefaultCoverSettings(), subtitle: { status: "PENDING", settings: createDefaultSubtitleSettings(), segments: [] },
    bgm: createDefaultBgmSettings(),
    ocr_enabled: false, ad_label_enabled: true, sources: [], ocr: {}, clips: [], scenes: [], logs: [],
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

test("S5: long captions use the shared safe-width layout and never exceed two lines", () => {
  const source = job();
  source.tts!.text = "모바일 화면에서 아주 긴 자막도 안전 영역을 벗어나지 않고 두 줄로 읽혀야 합니다.";
  const settings = createDefaultSubtitleSettings();
  const segments = buildSubtitleSegments(source, settings);
  const lineLimit = subtitleMaxCharsPerLine(settings.size);
  assert.ok(segments.length >= 2);
  for (const segment of segments) {
    assert.ok(Array.from(segment.text).length <= subtitleMaxSegmentChars(settings.size));
    const layout = layoutSubtitleText(segment.text, settings.size);
    assert.ok(layout.lines.length <= 2);
    for (const line of layout.lines) assert.ok(Array.from(line).length <= lineLimit, line);
    if (segment.text.split(/\s+/u).every((word) => Array.from(word).length <= lineLimit)) {
      assert.equal(layout.lines.join(" "), segment.text);
    }
  }
});

test("S6: ASS effects share preview semantics without overlapping character layers", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "instareels-effect-spec-"));
  try {
    const source = job();
    source.tts!.text = "길이가 긴 자막 문구입니다 자연스럽게 두 줄로 표시됩니다.";
    const settings = createDefaultSubtitleSettings();
    const segments = buildSubtitleSegments(source, settings);

    const typewriterFile = path.join(root, "typewriter.ass");
    await writeAssFile(typewriterFile, segments, { ...settings, effect: "typewriter" });
    const typewriter = await fs.readFile(typewriterFile, "utf8");
    assert.match(typewriter, /_blink_0/);
    assert.match(typewriter, /_blink_1/);
    assert.match(typewriter, /\|/);
    assert.match(typewriter, /\\N/);

    for (const effect of ["copybook", "flat_popout", "word_zoom"] as const) {
      const file = path.join(root, `${effect}.ass`);
      const count = await writeAssFile(file, segments, { ...settings, effect });
      const content = await fs.readFile(file, "utf8");
      assert.equal(count, segments.length, effect);
      assert.doesNotMatch(content, /_base|_char_|_word_\d/, effect);
      if (effect === "word_zoom") {
        assert.match(content, /\\fscx30\\fscy30/, effect);
        assert.doesNotMatch(content, /\\fscx118/, effect);
      }
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
