import fs from "node:fs/promises";
import path from "node:path";
import type { SubtitleSegment, SubtitleSettings } from "@/shared/types";
import { coverFontFamily } from "@/cover/fonts";
import {
  layoutSubtitleText,
  SUBTITLE_ANIMATION_MS,
  SUBTITLE_CANVAS,
  SUBTITLE_CURSOR_BLINK_MS,
  SUBTITLE_EFFECT_SPEC_BY_ID,
  SUBTITLE_SAFE_AREA,
  type SubtitleTextLayout,
} from "./spec";

function assTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(cs / 360000);
  const minutes = Math.floor((cs % 360000) / 6000);
  const secs = Math.floor((cs % 6000) / 100);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

function assColor(css: string): string {
  const value = css.replace("#", "");
  return `&H00${value.slice(4, 6)}${value.slice(2, 4)}${value.slice(0, 2)}&`.toUpperCase();
}

function escapeAss(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/{/g, "\\{").replace(/}/g, "\\}").replace(/\r?\n/g, "\\N");
}

function revealTimes(segment: SubtitleSegment): number[] {
  const chars = Array.from(segment.text);
  const output: number[] = [];
  let searchFrom = 0;
  for (const word of segment.word_timings) {
    const localIndex = segment.text.indexOf(word.text, searchFrom);
    if (localIndex < 0) continue;
    while (output.length < localIndex) output.push(word.start);
    const visible = Array.from(word.text);
    visible.forEach((_, index) => output.push(word.start + (word.end - word.start) * (index + 1) / visible.length));
    searchFrom = localIndex + word.text.length;
  }
  const span = Math.max(0.01, segment.end - segment.start);
  while (output.length < chars.length) output.push(segment.start + span * (output.length + 1) / chars.length);
  return output.slice(0, chars.length).map((value) => Math.max(segment.start, Math.min(segment.end - 0.01, value)));
}

function override(settings: SubtitleSettings, y: number, extra = "", position?: string): string {
  const outline = settings.stroke_enabled ? 7 : 0;
  const shadow = settings.shadow_enabled ? 2 : 0;
  return `{\\an5\\q2${position ?? `\\pos(${SUBTITLE_SAFE_AREA.centerX},${y})`}\\fs${settings.size}\\1c${assColor(settings.color)}\\3c&H00000000&\\bord${outline}\\shad${shadow}${extra}}`;
}

function dialogue(start: number, end: number, name: string, text: string, layer = 0): string {
  return `Dialogue: ${layer},${assTime(start)},${assTime(Math.max(start + 0.01, end))},Default,${name},0,0,0,,${text}`;
}

function laidOutText(layout: SubtitleTextLayout, visibleCharacters = Number.POSITIVE_INFINITY): string {
  const chars = Array.from(layout.source);
  const skipped = new Set(layout.skippedBeforeBreak);
  let output = "";
  for (let index = 0; index < chars.length && index < visibleCharacters; index += 1) {
    if (layout.lineBreakBefore === index) output += "\\N";
    if (!skipped.has(index)) output += escapeAss(chars[index] ?? "");
  }
  return output;
}

function segmentEvents(segment: SubtitleSegment, settings: SubtitleSettings, y: number): string[] {
  const chars = Array.from(segment.text);
  const times = revealTimes(segment);
  const layout = layoutSubtitleText(segment.text, settings.size);
  const fullText = laidOutText(layout);
  const events: string[] = [];
  const spec = SUBTITLE_EFFECT_SPEC_BY_ID[settings.effect];
  const durationMs = Math.max(10, Math.round((segment.end - segment.start) * 1000));
  const settleMs = Math.max(10, Math.min(durationMs, Math.round(SUBTITLE_ANIMATION_MS * spec.settleRatio)));

  if (spec.mode === "typing" || spec.mode === "rushed_typing") {
    chars.forEach((_, index) => {
      const start = index === 0 ? segment.start : (times[index - 1] ?? segment.start);
      const end = index + 1 < chars.length ? (times[index] ?? segment.end) : segment.end;
      const prefix = laidOutText(layout, index + 1);
      if (spec.mode === "rushed_typing") {
        events.push(dialogue(start, end, `${segment.segment_id}_char_${index + 1}`, override(settings, y) + prefix));
        return;
      }
      let cursorStart = start;
      let phase = Math.floor(((cursorStart - segment.start) * 1000) / SUBTITLE_CURSOR_BLINK_MS);
      while (cursorStart < end - 0.001) {
        const boundary = segment.start + ((phase + 1) * SUBTITLE_CURSOR_BLINK_MS) / 1000;
        const cursorEnd = Math.min(end, Math.max(cursorStart + 0.01, boundary));
        const cursor = phase % 2 === 0 ? "|" : "";
        events.push(dialogue(cursorStart, cursorEnd, `${segment.segment_id}_char_${index + 1}_blink_${phase}`, override(settings, y) + prefix + cursor));
        cursorStart = cursorEnd;
        phase += 1;
      }
    });
    return events;
  }

  if (spec.mode === "copybook") {
    const deltaY = Math.round(1920 * 0.036);
    const motion = `\\move(${SUBTITLE_SAFE_AREA.centerX},${y + deltaY},${SUBTITLE_SAFE_AREA.centerX},${y},0,${settleMs})`;
    const extra = `\\alpha&HFF&\\blur2\\t(0,${settleMs},0.33,\\alpha&H00&\\blur0)`;
    events.push(dialogue(segment.start, segment.end, `${segment.segment_id}_${spec.id}`, override(settings, y, extra, motion) + fullText));
    return events;
  }

  if (spec.mode === "pop") {
    const peak = Math.max(10, Math.round(settleMs * 0.64));
    const extra = `\\fscx30\\fscy30\\alpha&HFF&\\t(0,${peak},0.33,\\fscx114\\fscy114\\alpha&H00&)\\t(${peak},${settleMs},0.33,\\fscx100\\fscy100)`;
    events.push(dialogue(segment.start, segment.end, `${segment.segment_id}_${spec.id}`, override(settings, y, extra) + fullText));
    return events;
  }

  if (spec.mode === "pink_blink") {
    const pink = "&H00B34FFF&";
    const normal = assColor(settings.color);
    let extra = "";
    for (let offset = 0; offset < durationMs; offset += SUBTITLE_ANIMATION_MS) {
      const peak = Math.min(durationMs, offset + Math.round(SUBTITLE_ANIMATION_MS * 0.45));
      const cycleEnd = Math.min(durationMs, offset + SUBTITLE_ANIMATION_MS);
      extra += `\\t(${offset},${peak},0.33,\\1c${pink})\\t(${peak},${cycleEnd},0.33,\\1c${normal})`;
    }
    events.push(dialogue(segment.start, segment.end, `${segment.segment_id}_${spec.id}`, override(settings, y, extra) + fullText));
    return events;
  }

  const extra = spec.mode === "breeze"
    ? `\\alpha&HFF&\\blur2\\t(0,${settleMs},0.33,\\alpha&H00&\\blur0)`
    : spec.mode === "wipe"
      ? `\\clip(0,0,0,${SUBTITLE_CANVAS.height})\\t(0,${settleMs},0.33,\\clip(0,0,${SUBTITLE_CANVAS.width},${SUBTITLE_CANVAS.height}))`
      : `\\alpha&HFF&\\t(0,${settleMs},0.33,\\alpha&H00&)`;
  const position = spec.mode === "breeze"
    ? `\\move(${SUBTITLE_SAFE_AREA.centerX + 65},${y},${SUBTITLE_SAFE_AREA.centerX},${y},0,${settleMs})`
    : spec.mode === "slide"
      ? `\\move(${SUBTITLE_SAFE_AREA.centerX + 181},${y},${SUBTITLE_SAFE_AREA.centerX},${y},0,${settleMs})`
      : undefined;
  events.push(dialogue(segment.start, segment.end, `${segment.segment_id}_${spec.id}`, override(settings, y, extra, position) + fullText));
  return events;
}

export async function writeAssFile(file: string, segments: SubtitleSegment[], settings: SubtitleSettings, fontFamily = coverFontFamily(settings.font)): Promise<number> {
  const y = SUBTITLE_SAFE_AREA.y[settings.vertical_position];
  const events = segments.flatMap((segment) => segmentEvents(segment, settings, y));
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nScaledBorderAndShadow: yes\nWrapStyle: 2\nKerning: yes\nYCbCr Matrix: TV.709\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${fontFamily},${settings.size},${assColor(settings.color)},${assColor(settings.color)},&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,${settings.stroke_enabled ? 7 : 0},${settings.shadow_enabled ? 2 : 0},5,${SUBTITLE_SAFE_AREA.horizontalMargin},${SUBTITLE_SAFE_AREA.horizontalMargin},0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, header + events.join("\n") + "\n", "utf8");
  return events.length;
}
