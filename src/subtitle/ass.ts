import fs from "node:fs/promises";
import path from "node:path";
import type { SubtitleEffect, SubtitleSegment, SubtitleSettings, TtsWordTiming } from "@/shared/types";
import { coverFontFamily } from "@/cover/fonts";

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

function override(settings: SubtitleSettings, y: number, extra = ""): string {
  const outline = settings.stroke_enabled ? 7 : 0;
  const shadow = settings.shadow_enabled ? 2 : 0;
  return `{\\an5\\q2\\pos(540,${y})\\fs${settings.size}\\1c${assColor(settings.color)}\\3c&H00000000&\\bord${outline}\\shad${shadow}${extra}}`;
}

function dialogue(start: number, end: number, name: string, text: string, layer = 0): string {
  return `Dialogue: ${layer},${assTime(start)},${assTime(Math.max(start + 0.01, end))},Default,${name},0,0,0,,${text}`;
}

function taggedRange(text: string, start: number, end: number, open: string, close: string): string {
  const chars = Array.from(text);
  return escapeAss(chars.slice(0, start).join("")) + `{${open}}` + escapeAss(chars.slice(start, end).join("")) + `{${close}}` + escapeAss(chars.slice(end).join(""));
}

function segmentEvents(segment: SubtitleSegment, settings: SubtitleSettings, y: number): string[] {
  const chars = Array.from(segment.text);
  const times = revealTimes(segment);
  const base = override(settings, y);
  const events: string[] = [];
  const preset: SubtitleEffect = settings.effect;

  if (preset === "breeze" || preset === "transparent_gradient" || preset === "easy_slide") {
    const durationMs = Math.max(10, Math.round((segment.end - segment.start) * 1000));
    const extra = preset === "breeze"
      ? `\\move(575,${y},540,${y},0,${Math.min(650, durationMs)})\\alpha&HFF&\\blur2\\t(0,${Math.min(650, durationMs)},0.33,\\alpha&H00&\\blur0)`
      : preset === "transparent_gradient"
        ? `\\clip(0,0,0,1920)\\t(0,${Math.min(900, durationMs)},0.33,\\clip(0,0,1080,1920))`
        : `\\move(670,${y},540,${y},0,${Math.min(520, durationMs)})\\alpha&HFF&\\t(0,${Math.min(520, durationMs)},0.33,\\alpha&H00&)`;
    events.push(dialogue(segment.start, segment.end, `${segment.segment_id}_${preset}`, override(settings, y, extra) + escapeAss(segment.text)));
    return events;
  }

  if (preset === "word_zoom") {
    const words = [...segment.text.matchAll(/\S+/gu)];
    words.forEach((match, index) => {
      const startIndex = Array.from(segment.text.slice(0, match.index ?? 0)).length;
      const endIndex = startIndex + Array.from(match[0]).length;
      const timing = segment.word_timings[index];
      const start = Math.max(segment.start, timing?.start ?? times[startIndex] ?? segment.start);
      const end = Math.min(segment.end, segment.word_timings[index + 1]?.start ?? segment.end);
      const zoom = taggedRange(segment.text, startIndex, endIndex, "\\fscx118\\fscy118", "\\fscx100\\fscy100");
      events.push(dialogue(start, end, `${segment.segment_id}_word_${index + 1}`, base + zoom));
    });
    return events;
  }

  if (preset === "pink_blink") {
    events.push(dialogue(segment.start, segment.end, `${segment.segment_id}_pink_base`, base + escapeAss(segment.text)));
    chars.forEach((char, index) => {
      if (!char.trim()) return;
      const start = times[index] ?? segment.start;
      const end = Math.min(segment.end, start + 0.18);
      events.push(dialogue(start, end, `${segment.segment_id}_pink_${index + 1}`, base + taggedRange(segment.text, index, index + 1, "\\1c&H00B34FFF&", `\\1c${assColor(settings.color)}`), 2));
    });
    return events;
  }

  chars.forEach((_, index) => {
    const start = index === 0 ? segment.start : (times[index - 1] ?? segment.start);
    const end = index + 1 < chars.length ? (times[index] ?? segment.end) : segment.end;
    const prefix = escapeAss(chars.slice(0, index + 1).join(""));
    if (preset === "typewriter" || preset === "rushed_typing") {
      const cursor = preset === "typewriter" ? "|" : "";
      events.push(dialogue(start, end, `${segment.segment_id}_char_${index + 1}`, base + prefix + cursor));
    } else {
      const prior = escapeAss(chars.slice(0, index).join(""));
      const current = escapeAss(chars[index] ?? "");
      const animation = preset === "copybook"
        ? `\\alpha&HFF&\\blur2\\move(540,${y + 29},540,${y},0,480)\\t(0,480,0.33,\\alpha&H00&\\blur0)`
        : "\\fscx25\\fscy25\\alpha&HFF&\\t(0,200,0.33,\\fscx116\\fscy116\\alpha&H00&)\\t(200,340,0.33,\\fscx100\\fscy100)";
      events.push(dialogue(start, end, `${segment.segment_id}_${preset}_${index + 1}_base`, base + prior));
      events.push(dialogue(start, end, `${segment.segment_id}_${preset}_${index + 1}`, override(settings, y, animation) + current, 2));
    }
  });
  return events;
}

export async function writeAssFile(file: string, segments: SubtitleSegment[], settings: SubtitleSettings, fontFamily = coverFontFamily(settings.font)): Promise<number> {
  const y = settings.vertical_position === "top" ? 360 : settings.vertical_position === "middle" ? 960 : 1510;
  const events = segments.flatMap((segment) => segmentEvents(segment, settings, y));
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nScaledBorderAndShadow: yes\nWrapStyle: 2\nKerning: yes\nYCbCr Matrix: TV.709\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${fontFamily},${settings.size},${assColor(settings.color)},${assColor(settings.color)},&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,${settings.stroke_enabled ? 7 : 0},${settings.shadow_enabled ? 2 : 0},5,64,64,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, header + events.join("\n") + "\n", "utf8");
  return events.length;
}
