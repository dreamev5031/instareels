import assert from "node:assert/strict";
import test from "node:test";
import { alignmentToWordTimings } from "./elevenlabs";
import type { ElevenLabsAlignment } from "@/elevenlabs/client";

function alignment(pairs: Array<[string, number, number]>): ElevenLabsAlignment {
  return {
    characters: pairs.map((p) => p[0]),
    character_start_times_seconds: pairs.map((p) => p[1]),
    character_end_times_seconds: pairs.map((p) => p[2]),
  };
}

test("character alignment groups into words split on whitespace, with correct char offsets", () => {
  // "이거 진짜" -> two words separated by one space character.
  const align = alignment([
    ["이", 0.0, 0.12],
    ["거", 0.12, 0.24],
    [" ", 0.24, 0.26],
    ["진", 0.26, 0.46],
    ["짜", 0.46, 0.81],
  ]);
  const words = alignmentToWordTimings(align, 1.0);
  assert.equal(words.length, 2);
  assert.deepEqual(words[0], { text: "이거", start: 0.0, end: 0.24, text_start: 0, text_end: 2 });
  assert.deepEqual(words[1], { text: "진짜", start: 0.26, end: 0.81, text_start: 3, text_end: 5 });
});

test("trailing punctuation stays attached to the preceding word (non-whitespace run)", () => {
  const align = alignment([
    ["안", 0.0, 0.1],
    ["녕", 0.1, 0.2],
    [".", 0.2, 0.22],
    [" ", 0.22, 0.24],
    ["네", 0.24, 0.4],
  ]);
  const words = alignmentToWordTimings(align, 1.0);
  assert.equal(words.length, 2);
  assert.equal(words[0]!.text, "안녕.");
  assert.equal(words[0]!.text_start, 0);
  assert.equal(words[0]!.text_end, 3);
  assert.equal(words[1]!.text, "네");
});

test("consecutive whitespace and leading/trailing spaces never produce empty words", () => {
  const align = alignment([
    [" ", 0.0, 0.02],
    ["A", 0.02, 0.1],
    [" ", 0.1, 0.11],
    [" ", 0.11, 0.12],
    ["B", 0.12, 0.2],
    [" ", 0.2, 0.22],
  ]);
  const words = alignmentToWordTimings(align, 1.0);
  assert.equal(words.length, 2);
  assert.equal(words[0]!.text, "A");
  assert.equal(words[1]!.text, "B");
});

test("word times are clamped to the real probed audio duration", () => {
  const align = alignment([
    ["가", 0.0, 0.5],
    ["나", 0.5, 1.6],
  ]);
  const words = alignmentToWordTimings(align, 1.2);
  assert.equal(words.length, 1);
  assert.equal(words[0]!.end, 1.2);
});

test("an alignment with only whitespace produces no words", () => {
  const align = alignment([
    [" ", 0.0, 0.1],
    [" ", 0.1, 0.2],
  ]);
  assert.deepEqual(alignmentToWordTimings(align, 1.0), []);
});
