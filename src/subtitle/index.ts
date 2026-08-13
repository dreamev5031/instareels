import type { Job, SubtitleSegment, SubtitleSettings, TtsWordTiming } from "@/shared/types";
import { COVER_FONT_KEYS, SUBTITLE_EFFECTS, PipelineError } from "@/shared/types";
import { addLog, saveJob } from "@/jobs/store";
import { layoutSubtitleText, subtitleMaxSegmentChars } from "./spec";

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function splitSentenceFirst(text: string, maxCharacters: number, fontSize: number): Array<{ text: string; start: number; end: number }> {
  const output: Array<{ text: string; start: number; end: number }> = [];
  const sentencePattern = /[^.!?。！？]+[.!?。！？]?/gu;
  for (const sentenceMatch of text.matchAll(sentencePattern)) {
    const raw = sentenceMatch[0];
    const sentenceStart = sentenceMatch.index ?? 0;
    const words = [...raw.matchAll(/\S+/gu)];
    let pendingStart = -1;
    let pendingEnd = -1;
    let pendingText = "";
    const flush = () => {
      if (!pendingText) return;
      output.push({ text: pendingText, start: pendingStart, end: pendingEnd });
      pendingStart = -1;
      pendingEnd = -1;
      pendingText = "";
    };
    for (const wordMatch of words) {
      const word = wordMatch[0];
      const wordStart = sentenceStart + (wordMatch.index ?? 0);
      const wordEnd = wordStart + word.length;
      const candidate = pendingText ? `${pendingText} ${word}` : word;
      const layout = layoutSubtitleText(candidate, fontSize);
      const keepsWholeWords = layout.lines.join(" ") === candidate;
      if (Array.from(candidate).length <= maxCharacters && (keepsWholeWords || !pendingText)) {
        if (pendingStart < 0) pendingStart = wordStart;
        pendingEnd = wordEnd;
        pendingText = candidate;
        continue;
      }
      flush();
      const graphemes = Array.from(word);
      let offset = 0;
      while (graphemes.length > maxCharacters) {
        const part = graphemes.splice(0, maxCharacters).join("");
        output.push({ text: part, start: wordStart + offset, end: wordStart + offset + part.length });
        offset += part.length;
      }
      if (graphemes.length) {
        pendingStart = wordStart + offset;
        pendingEnd = wordEnd;
        pendingText = graphemes.join("");
      }
    }
    flush();
  }
  return output;
}

function fallbackWordTimings(text: string, duration: number): TtsWordTiming[] {
  const words = [...text.matchAll(/\S+/gu)];
  const visible = words.reduce((sum, match) => sum + Array.from(match[0]).length, 0) || 1;
  let cursor = 0;
  return words.map((match) => {
    const weight = Array.from(match[0]).length / visible;
    const start = cursor;
    cursor += duration * weight;
    return { text: match[0], start, end: cursor, text_start: match.index ?? 0, text_end: (match.index ?? 0) + match[0].length };
  });
}

export function buildSubtitleSegments(job: Job, settings: SubtitleSettings = job.subtitle.settings): SubtitleSegment[] {
  if (!job.tts) throw new PipelineError("RENDER", "SUBTITLE_TIMING_FAILED", "TTS 결과가 없어 자막 타이밍을 만들 수 없습니다.");
  const text = cleanText(job.tts.text);
  const duration = job.tts.duration;
  const providerWords = job.tts.timing?.words?.length ? job.tts.timing.words : fallbackWordTimings(text, duration);
  const chunks = splitSentenceFirst(text, subtitleMaxSegmentChars(settings.size), settings.size);
  if (!chunks.length || !(duration > 0)) throw new PipelineError("RENDER", "SUBTITLE_TIMING_FAILED", "자막 segment를 생성할 수 없습니다.");

  const initial = chunks.map((chunk, index) => {
    const words = providerWords.filter((word) => {
      const start = word.text_start ?? -1;
      const end = word.text_end ?? -1;
      return start < chunk.end && end > chunk.start;
    });
    const proportionalStart = duration * chunk.start / Math.max(1, text.length);
    const firstStart = words[0]?.start ?? proportionalStart;
    return { chunk, words, start: index === 0 ? 0 : Math.max(0, firstStart - 0.04) };
  });

  return initial.map((item, index) => {
    const start = Math.min(duration, item.start);
    const nextStart = initial[index + 1]?.start ?? duration;
    const end = Math.max(start + 0.01, Math.min(duration, nextStart));
    return {
      segment_id: `SUBTITLE_${String(index + 1).padStart(3, "0")}`,
      text: item.chunk.text,
      start: Math.round(start * 1000) / 1000,
      end: Math.round(end * 1000) / 1000,
      word_timings: item.words,
    };
  });
}

export function validateSubtitleSettings(settings: SubtitleSettings): void {
  if (!COVER_FONT_KEYS.includes(settings.font)) throw new Error("지원하지 않는 자막 폰트입니다.");
  if (!SUBTITLE_EFFECTS.includes(settings.effect)) throw new Error("지원하지 않는 자막 효과입니다.");
  if (!["top", "middle", "bottom"].includes(settings.vertical_position)) throw new Error("자막 위치가 올바르지 않습니다.");
  if (!Number.isInteger(settings.size) || settings.size < 40 || settings.size > 180) throw new Error("자막 크기는 40~180px이어야 합니다.");
  if (!/^#[0-9a-f]{6}$/i.test(settings.color)) throw new Error("자막 색상은 #RRGGBB 형식이어야 합니다.");
}

export function saveSubtitleSettings(job: Job, settings: SubtitleSettings): void {
  try {
    validateSubtitleSettings(settings);
    const segments = settings.enabled ? buildSubtitleSegments(job, settings) : [];
    job.subtitle = {
      status: "SUCCESS",
      settings,
      segments,
      timing_source: job.tts?.timing?.source ?? "duration_fallback",
    };
    job.stages.RENDER = { status: "PENDING" };
    job.render = undefined;
    addLog(job, "RENDER", "info", settings.enabled ? `자막 설정 저장: ${segments.length}개 segment` : "자막 사용 안 함", {
      subtitle_enabled: settings.enabled,
      font: settings.font,
      effect: settings.effect,
      segment_count: segments.length,
      timing_source: job.subtitle.timing_source,
    });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    job.subtitle = { status: "FAILED", settings, segments: [], error: {
      stage: "RENDER", error_code: "SUBTITLE_INVALID_SETTINGS", message, timestamp: new Date().toISOString(),
    } };
    throw new PipelineError("RENDER", "SUBTITLE_INVALID_SETTINGS", message);
  } finally {
    saveJob(job);
  }
}

