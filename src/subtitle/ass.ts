import fs from "node:fs/promises";
import path from "node:path";
import type { SubtitleSegment, SubtitleSettings } from "@/shared/types";
import { coverFontFamily } from "@/cover/fonts";
import {
  layoutSubtitleText,
  SUBTITLE_CANVAS,
  SUBTITLE_CURSOR_BLINK_MS,
  SUBTITLE_EASE_OUT_CUBIC,
  SUBTITLE_EFFECT_SPEC_BY_ID,
  SUBTITLE_EFFECT_TIMING,
  SUBTITLE_PINK_ASS,
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

function dialogue(start: number, end: number, name: string, text: string, layer = 0): string {
  return `Dialogue: ${layer},${assTime(start)},${assTime(Math.max(start + 0.01, end))},Default,${name},0,0,0,,${text}`;
}

function override(settings: SubtitleSettings, y: number, extra = "", position?: string): string {
  const outline = settings.stroke_enabled ? 7 : 0;
  const shadow = settings.shadow_enabled ? 2 : 0;
  return `{\\an5\\q2${position ?? `\\pos(${SUBTITLE_SAFE_AREA.centerX},${y})`}\\fs${settings.size}\\1c${assColor(settings.color)}\\3c&H00000000&\\bord${outline}\\shad${shadow}${extra}}`;
}

function layoutTokens(layout: SubtitleTextLayout): Array<{ sourceIndex: number; text: string }> {
  const chars = Array.from(layout.source);
  const skipped = new Set(layout.skippedBeforeBreak);
  const output: Array<{ sourceIndex: number; text: string }> = [];
  for (let index = 0; index < chars.length; index += 1) {
    if (layout.lineBreakBefore === index) output.push({ sourceIndex: -1, text: "\\N" });
    if (!skipped.has(index)) output.push({ sourceIndex: index, text: escapeAss(chars[index] ?? "") });
  }
  return output;
}

function laidOutRange(layout: SubtitleTextLayout, visibleStart: number, visibleEnd: number, hiddenOutside = true): string {
  const tokens = layoutTokens(layout);
  let visible = !hiddenOutside;
  let output = "";
  for (const token of tokens) {
    if (token.sourceIndex < 0) {
      output += token.text;
      continue;
    }
    const shouldShow = token.sourceIndex >= visibleStart && token.sourceIndex < visibleEnd;
    if (hiddenOutside && shouldShow !== visible) {
      output += shouldShow ? "{\\alpha&H00&}" : "{\\alpha&HFF&}";
      visible = shouldShow;
    }
    output += token.text;
  }
  return output;
}

function laidOutFull(layout: SubtitleTextLayout): string {
  return laidOutRange(layout, 0, Number.POSITIVE_INFINITY, false);
}

function characterRevealTimes(segment: SubtitleSegment): number[] {
  const source = Array.from(segment.text);
  const times = new Array<number>(source.length).fill(Number.NaN);
  let searchFrom = 0;
  for (const word of segment.word_timings) {
    const wordText = String(word.text || "");
    const localIndex = segment.text.indexOf(wordText, searchFrom);
    if (localIndex < 0) continue;
    const chars = Array.from(wordText);
    const span = Math.max(0.01, word.end - word.start);
    chars.forEach((_, index) => {
      times[localIndex + index] = word.start + span * (index + 1) / chars.length;
    });
    for (let index = searchFrom; index < localIndex; index += 1) {
      if (/\s/u.test(source[index] ?? "")) times[index] = word.start;
    }
    searchFrom = localIndex + chars.length;
  }

  const duration = Math.max(0.01, segment.end - segment.start);
  let previous = segment.start;
  for (let index = 0; index < source.length; index += 1) {
    if (Number.isFinite(times[index])) {
      previous = Math.max(previous, times[index]!);
      continue;
    }
    if (/\s/u.test(source[index] ?? "")) {
      times[index] = previous;
      continue;
    }
    const fallback = segment.start + duration * (index + 1) / Math.max(1, source.length);
    previous = Math.max(previous, fallback);
    times[index] = previous;
  }
  return times.map((value) => Math.max(segment.start, Math.min(segment.end - 0.01, value)));
}

function visibleCharacterIndices(layout: SubtitleTextLayout): number[] {
  const skipped = new Set(layout.skippedBeforeBreak);
  return Array.from(layout.source).map((_, index) => index).filter((index) => !skipped.has(index));
}

function typingEvents(segment: SubtitleSegment, settings: SubtitleSettings, y: number, withCursor: boolean): string[] {
  const layout = layoutSubtitleText(segment.text, settings.size);
  const times = characterRevealTimes(segment);
  const indices = visibleCharacterIndices(layout).filter((index) => !/\s/u.test(Array.from(layout.source)[index] ?? ""));
  const events: string[] = [];
  if (!indices.length) return events;
  const phraseStart = Math.max(segment.start, times[indices[0]!] ?? segment.start);

  indices.forEach((sourceIndex, revealIndex) => {
    const start = Math.max(segment.start, times[sourceIndex] ?? segment.start);
    const nextIndex = indices[revealIndex + 1];
    const end = nextIndex === undefined ? segment.end : Math.max(start + 0.01, times[nextIndex] ?? segment.end);
    const prefixEnd = sourceIndex + 1;
    const phraseText = override(settings, y) + laidOutRange(layout, 0, prefixEnd, true);

    if (!withCursor) {
      events.push(dialogue(start, end, `${segment.segment_id}_char_${revealIndex + 1}_text`, phraseText));
      return;
    }

    let cursorStart = start;
    while (cursorStart < end - 0.001) {
      const elapsed = Math.max(0, cursorStart - phraseStart);
      const phase = Math.floor((elapsed * 1000 + 0.001) / SUBTITLE_CURSOR_BLINK_MS);
      const boundary = phraseStart + ((phase + 1) * SUBTITLE_CURSOR_BLINK_MS) / 1000;
      const cursorEnd = Math.min(end, Math.max(cursorStart + 0.01, boundary));
      events.push(dialogue(cursorStart, cursorEnd, `${segment.segment_id}_char_${revealIndex + 1}_${phase % 2 === 0 ? "text_on" : "cursor_off"}_${phase}`, phraseText, 0));
      if (phase % 2 === 0) {
        const cursorOverlay =
          override(settings, y) +
          laidOutRange(layout, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, true)
            .replace("{\\alpha&HFF&}", "{\\alpha&HFF&}") +
          "";
        const tokens = layoutTokens(layout);
        let body = "{\\alpha&HFF&}";
        for (const token of tokens) {
          if (token.sourceIndex < 0) {
            body += token.text;
            continue;
          }
          if (token.sourceIndex === prefixEnd) body += `{\\alpha&H00&\\1c${assColor(settings.color)}}|{\\alpha&HFF&}`;
          body += token.text;
        }
        if (prefixEnd >= Array.from(layout.source).length) body += `{\\alpha&H00&\\1c${assColor(settings.color)}}|`;
        events.push(dialogue(cursorStart, cursorEnd, `${segment.segment_id}_char_${revealIndex + 1}_cursor_on_${phase}`, override(settings, y) + body, 1));
        void cursorOverlay;
      }
      cursorStart = cursorEnd;
    }
  });
  return events;
}

function characterEntryEvents(segment: SubtitleSegment, settings: SubtitleSettings, y: number, mode: "copybook" | "flat_popout"): string[] {
  const layout = layoutSubtitleText(segment.text, settings.size);
  const times = characterRevealTimes(segment);
  const chars = Array.from(layout.source);
  const indices = visibleCharacterIndices(layout).filter((index) => !/\s/u.test(chars[index] ?? ""));
  const events: string[] = [];

  indices.forEach((sourceIndex, index) => {
    const start = Math.max(segment.start, times[sourceIndex] ?? segment.start);
    const nextIndex = indices[index + 1];
    const end = nextIndex === undefined ? segment.end : Math.max(start + 0.01, times[nextIndex] ?? segment.end);
    const base = override(settings, y) + laidOutRange(layout, 0, sourceIndex, true);
    events.push(dialogue(start, end, `${segment.segment_id}_char_${index + 1}_base`, base, 0));

    if (mode === "copybook") {
      const rise = Math.round(settings.size * 0.28 * 100) / 100;
      const motionMs = SUBTITLE_EFFECT_TIMING.copybookMotionMs;
      const move = `\\move(${SUBTITLE_SAFE_AREA.centerX},${y + rise},${SUBTITLE_SAFE_AREA.centerX},${y},0,${motionMs})`;
      const extra = `\\alpha&HFF&\\blur2\\t(0,${motionMs},${SUBTITLE_EASE_OUT_CUBIC},\\alpha&H00&\\blur0)`;
      events.push(dialogue(start, end, `${segment.segment_id}_char_${index + 1}_copybook`, override(settings, y, extra, move) + laidOutRange(layout, sourceIndex, sourceIndex + 1, true), 2));
    } else {
      const extra = `\\fscx25\\fscy25\\alpha&HFF&\\t(0,${SUBTITLE_EFFECT_TIMING.flatPopPeakMs},${SUBTITLE_EASE_OUT_CUBIC},\\fscx116\\fscy116\\alpha&H00&)\\t(${SUBTITLE_EFFECT_TIMING.flatPopPeakMs},${SUBTITLE_EFFECT_TIMING.flatPopSettleMs},${SUBTITLE_EASE_OUT_CUBIC},\\fscx100\\fscy100)`;
      events.push(dialogue(start, end, `${segment.segment_id}_char_${index + 1}_flat_popout`, override(settings, y, extra) + laidOutRange(layout, sourceIndex, sourceIndex + 1, true), 2));
    }
  });
  return events;
}

function wordRanges(text: string): Array<{ start: number; end: number }> {
  return [...text.matchAll(/\S+/gu)].map((match) => ({ start: match.index ?? 0, end: (match.index ?? 0) + Array.from(match[0]).length }));
}

function insertRangeTags(layout: SubtitleTextLayout, start: number, end: number, openTags: string, closeTags: string): string {
  const tokens = layoutTokens(layout);
  let output = "";
  for (const token of tokens) {
    if (token.sourceIndex < 0) {
      output += token.text;
      continue;
    }
    if (token.sourceIndex === start) output += `{${openTags}}`;
    if (token.sourceIndex === end) output += `{${closeTags}}`;
    output += token.text;
  }
  if (end >= Array.from(layout.source).length) output += `{${closeTags}}`;
  return output;
}

function wordZoomEvents(segment: SubtitleSegment, settings: SubtitleSettings, y: number): string[] {
  const layout = layoutSubtitleText(segment.text, settings.size);
  const times = characterRevealTimes(segment);
  const ranges = wordRanges(layout.source);
  return ranges.map((range, index) => {
    const start = Math.max(segment.start, times[range.start] ?? segment.start);
    const next = ranges[index + 1];
    const end = next ? Math.max(start + 0.01, times[next.start] ?? segment.end) : segment.end;
    const zoomMs = Math.min(SUBTITLE_EFFECT_TIMING.wordZoomMaxMs, Math.max(SUBTITLE_EFFECT_TIMING.wordZoomMinMs, Math.round((end - start) * 1000)));
    const mid = Math.max(80, Math.floor(zoomMs / 2));
    const tags = `\\fscx100\\fscy100\\t(0,${mid},${SUBTITLE_EASE_OUT_CUBIC},\\fscx${SUBTITLE_EFFECT_TIMING.wordZoomScalePercent}\\fscy${SUBTITLE_EFFECT_TIMING.wordZoomScalePercent})\\t(${mid},${zoomMs},${SUBTITLE_EASE_OUT_CUBIC},\\fscx100\\fscy100)`;
    const text = insertRangeTags(layout, range.start, range.end, tags, "\\fscx100\\fscy100");
    return dialogue(start, end, `${segment.segment_id}_word_${index + 1}_word_zoom`, override(settings, y) + text);
  });
}

function phraseEvent(segment: SubtitleSegment, settings: SubtitleSettings, y: number, mode: "breeze" | "transparent_gradient" | "easy_slide"): string[] {
  const layout = layoutSubtitleText(segment.text, settings.size);
  const durationMs = Math.max(10, Math.round((segment.end - segment.start) * 1000));
  let extra = "";
  let position: string | undefined;
  if (mode === "breeze") {
    const motion = Math.min(SUBTITLE_EFFECT_TIMING.breezeMaxMs, Math.max(SUBTITLE_EFFECT_TIMING.breezeMinMs, durationMs - 10));
    const offset = Math.round(settings.size * 0.35 * 100) / 100;
    position = `\\move(${SUBTITLE_SAFE_AREA.centerX + offset},${y},${SUBTITLE_SAFE_AREA.centerX},${y},0,${motion})`;
    extra = `\\alpha&HFF&\\blur2\\t(0,${motion},${SUBTITLE_EASE_OUT_CUBIC},\\alpha&H00&\\blur0)`;
  } else if (mode === "transparent_gradient") {
    const sweep = Math.min(SUBTITLE_EFFECT_TIMING.gradientMaxMs, Math.max(SUBTITLE_EFFECT_TIMING.gradientMinMs, durationMs - 10));
    const feather = Math.max(1.5, Math.round((SUBTITLE_CANVAS.width * 0.04 / 10) * 100) / 100);
    extra = `\\clip(0,0,0,4000)\\alpha&H00&\\blur${feather}\\t(0,${sweep},${SUBTITLE_EASE_OUT_CUBIC},\\clip(0,0,${SUBTITLE_CANVAS.width},4000)\\blur0)`;
  } else {
    const motion = Math.min(SUBTITLE_EFFECT_TIMING.easySlideMaxMs, Math.max(SUBTITLE_EFFECT_TIMING.easySlideMinMs, durationMs - 10));
    const offset = Math.round(SUBTITLE_CANVAS.width * 0.12 * 100) / 100;
    position = `\\move(${SUBTITLE_SAFE_AREA.centerX + offset},${y},${SUBTITLE_SAFE_AREA.centerX},${y},0,${motion})`;
    extra = `\\alpha&HFF&\\t(0,${motion},${SUBTITLE_EASE_OUT_CUBIC},\\alpha&H00&)`;
  }
  return [dialogue(segment.start, segment.end, `${segment.segment_id}_phrase_${mode}`, override(settings, y, extra, position) + laidOutFull(layout))];
}

function pinkBlinkEvents(segment: SubtitleSegment, settings: SubtitleSettings, y: number): string[] {
  const layout = layoutSubtitleText(segment.text, settings.size);
  const full = laidOutFull(layout);
  const chars = Array.from(layout.source);
  const times = characterRevealTimes(segment);
  const normal = assColor(settings.color);
  const events = [dialogue(segment.start, segment.end, `${segment.segment_id}_phrase_pink_blink_base`, override(settings, y) + full)];
  chars.forEach((character, index) => {
    if (/\s/u.test(character)) return;
    const start = Math.max(segment.start, times[index] ?? segment.start);
    const next = index + 1 < chars.length ? times[index + 1] ?? segment.end : segment.end;
    const end = Math.min(segment.end, Math.max(start + SUBTITLE_EFFECT_TIMING.pinkMinMs / 1000, Math.min(next, start + SUBTITLE_EFFECT_TIMING.pinkMaxMs / 1000)));
    const text = insertRangeTags(layout, index, index + 1, `\\1c${SUBTITLE_PINK_ASS}`, `\\1c${normal}`);
    events.push(dialogue(start, end, `${segment.segment_id}_char_${index + 1}_pink_blink`, override(settings, y) + text, 3));
  });
  return events;
}

export function buildSubtitleAssEvents(segment: SubtitleSegment, settings: SubtitleSettings, y: number): string[] {
  const mode = SUBTITLE_EFFECT_SPEC_BY_ID[settings.effect].mode;
  if (mode === "typewriter") return typingEvents(segment, settings, y, true);
  if (mode === "rushed_typing") return typingEvents(segment, settings, y, false);
  if (mode === "copybook" || mode === "flat_popout") return characterEntryEvents(segment, settings, y, mode);
  if (mode === "word_zoom") return wordZoomEvents(segment, settings, y);
  if (mode === "pink_blink") return pinkBlinkEvents(segment, settings, y);
  return phraseEvent(segment, settings, y, mode);
}

export async function writeAssFile(file: string, segments: SubtitleSegment[], settings: SubtitleSettings, fontFamily = coverFontFamily(settings.font)): Promise<number> {
  const y = SUBTITLE_SAFE_AREA.y[settings.vertical_position];
  const events = segments.flatMap((segment) => buildSubtitleAssEvents(segment, settings, y));
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nScaledBorderAndShadow: yes\nWrapStyle: 2\nKerning: yes\nYCbCr Matrix: TV.709\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${fontFamily},${settings.size},${assColor(settings.color)},${assColor(settings.color)},&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,${settings.stroke_enabled ? 7 : 0},${settings.shadow_enabled ? 2 : 0},5,${SUBTITLE_SAFE_AREA.horizontalMargin},${SUBTITLE_SAFE_AREA.horizontalMargin},0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, header + events.join("\n") + "\n", "utf8");
  return events.length;
}
