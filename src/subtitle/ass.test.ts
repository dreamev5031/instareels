import assert from "node:assert/strict";
import test from "node:test";
import type { SubtitleEffect, SubtitleSegment, SubtitleSettings } from "@/shared/types";
import { buildSubtitleAssEvents } from "./ass";
import { layoutSubtitleText, SUBTITLE_EFFECT_SPECS } from "./spec";

const segment: SubtitleSegment = {
  segment_id: "SUBTITLE_001",
  text: "안녕하세요 반가워요",
  start: 0,
  end: 2.4,
  word_timings: [
    { text: "안녕하세요", start: 0.05, end: 1.05, text_start: 0, text_end: 5 },
    { text: "반가워요", start: 1.15, end: 2.25, text_start: 6, text_end: 10 },
  ],
};

const settings: SubtitleSettings = {
  enabled: true,
  font: "pretendard",
  size: 104,
  color: "#ffffff",
  stroke_enabled: true,
  shadow_enabled: true,
  vertical_position: "bottom",
  effect: "typewriter",
};

function events(effect: SubtitleEffect) {
  return buildSubtitleAssEvents(segment, { ...settings, effect }, 1510);
}

function timeToCs(value: string): number {
  const [, h, m, s, cs] = value.match(/(\d+):(\d+):(\d+)\.(\d+)/) ?? [];
  return Number(h) * 360000 + Number(m) * 6000 + Number(s) * 100 + Number(cs);
}

function eventTimes(line: string) {
  const fields = line.split(",", 4);
  return { start: timeToCs(fields[1]!), end: timeToCs(fields[2]!) };
}

test("all nine legacy subtitle presets are registered with original animation units", () => {
  assert.deepEqual(SUBTITLE_EFFECT_SPECS.map((item) => [item.id, item.animationUnit]), [
    ["typewriter", "character"], ["rushed_typing", "character"], ["copybook", "character"],
    ["flat_popout", "character"], ["word_zoom", "word"], ["breeze", "phrase"],
    ["transparent_gradient", "phrase"], ["pink_blink", "character_accent"], ["easy_slide", "phrase"],
  ]);
});

test("typewriter emits cumulative full-layout states with non-overlapping layer-0 events and real cursor blink events", () => {
  const result = events("typewriter");
  const base = result.filter((line) => line.startsWith("Dialogue: 0"));
  const cursor = result.filter((line) => line.startsWith("Dialogue: 1"));
  assert.ok(base.length >= 9);
  assert.ok(cursor.length > 0);
  assert.ok(base.some((line) => line.includes("안녕") && line.includes("\\alpha&HFF&")));
  assert.ok(cursor.some((line) => line.includes("_cursor_on_")));
  for (let index = 1; index < base.length; index += 1) {
    const previous = eventTimes(base[index - 1]!);
    const current = eventTimes(base[index]!);
    assert.ok(previous.end <= current.start, `${base[index - 1]} overlaps ${base[index]}`);
  }
});

test("copybook and flat popout use per-character base plus overlay instead of whole-caption animation", () => {
  const copybook = events("copybook");
  const popout = events("flat_popout");
  assert.ok(copybook.filter((line) => line.startsWith("Dialogue: 2")).length >= 9);
  assert.ok(copybook.some((line) => line.includes("\\blur2") && line.includes("\\move(")));
  assert.ok(!copybook.some((line) => line.includes("\\fscx25")));
  assert.ok(popout.filter((line) => line.startsWith("Dialogue: 2")).length >= 9);
  assert.ok(popout.some((line) => line.includes("\\fscx25") && line.includes("\\fscx116")));
  assert.ok(!popout.some((line) => line.includes("\\blur2")));
});

test("word zoom keeps full phrase visible and pulses only active word", () => {
  const result = events("word_zoom");
  assert.equal(result.length, 2);
  assert.ok(result.every((line) => line.includes("안녕하세요") && line.includes("반가워요")));
  assert.ok(result.every((line) => line.includes("\\fscx118")));
});

test("phrase and pink presets retain original ASS mechanisms", () => {
  assert.ok(events("breeze")[0]!.includes("\\move("));
  assert.ok(events("breeze")[0]!.includes("\\blur2"));
  assert.ok(events("transparent_gradient")[0]!.includes("\\clip(0,0,0,4000)"));
  assert.ok(events("easy_slide")[0]!.includes("\\move(669.6,1510,540,1510"));
  const pink = events("pink_blink");
  assert.ok(pink.length > 1);
  assert.ok(pink.some((line) => line.startsWith("Dialogue: 3") && line.includes("&H00B34FFF&")));
});

test("long subtitle is constrained to at most two centered lines", () => {
  const layout = layoutSubtitleText("이 제품은 생각보다 훨씬 괜찮아서 실제로 며칠 써보고도 계속 사용하고 있습니다.", 104);
  assert.ok(layout.lines.length <= 2);
  assert.ok(layout.lines.every((line) => Array.from(line).length <= 8));
});
