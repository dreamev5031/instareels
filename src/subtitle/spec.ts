import type { SubtitleEffect, SubtitleVerticalPosition } from "@/shared/types";

export const SUBTITLE_CANVAS = { width: 1080, height: 1920 } as const;
export const SUBTITLE_SAFE_AREA = {
  horizontalMargin: 64,
  centerX: 540,
  y: { top: 360, middle: 960, bottom: 1510 } satisfies Record<SubtitleVerticalPosition, number>,
} as const;
export const SUBTITLE_ANIMATION_MS = 1150;
export const SUBTITLE_CURSOR_BLINK_MS = 250;
export const SUBTITLE_LINE_HEIGHT = 1.22;
export const SUBTITLE_MAX_LINES = 2;

export type SubtitleEffectMode =
  | "typing"
  | "rushed_typing"
  | "copybook"
  | "pop"
  | "breeze"
  | "wipe"
  | "pink_blink"
  | "slide";

export interface SubtitleEffectSpec {
  id: SubtitleEffect;
  label: string;
  mode: SubtitleEffectMode;
  previewClass: string;
  settleRatio: number;
}

export const SUBTITLE_EFFECT_SPECS: readonly SubtitleEffectSpec[] = [
  { id: "typewriter", label: "타자기", mode: "typing", previewClass: "subtitle-effect-typewriter", settleRatio: 0.85 },
  { id: "rushed_typing", label: "성급한 타이핑", mode: "rushed_typing", previewClass: "subtitle-effect-rushed_typing", settleRatio: 0.85 },
  { id: "copybook", label: "카피북", mode: "copybook", previewClass: "subtitle-effect-copybook", settleRatio: 0.5 },
  { id: "flat_popout", label: "플랫 팝아웃", mode: "pop", previewClass: "subtitle-effect-flat_popout", settleRatio: 0.7 },
  // The current UI preview defines word zoom as one whole-caption pop.
  { id: "word_zoom", label: "단어 줌", mode: "pop", previewClass: "subtitle-effect-word_zoom", settleRatio: 0.7 },
  { id: "breeze", label: "산들바람", mode: "breeze", previewClass: "subtitle-effect-breeze", settleRatio: 0.55 },
  { id: "transparent_gradient", label: "투명한 구배", mode: "wipe", previewClass: "subtitle-effect-transparent_gradient", settleRatio: 0.7 },
  { id: "pink_blink", label: "핑크 블링크", mode: "pink_blink", previewClass: "subtitle-effect-pink_blink", settleRatio: 1 },
  { id: "easy_slide", label: "이지 슬라이드", mode: "slide", previewClass: "subtitle-effect-easy_slide", settleRatio: 0.55 },
] as const;

export const SUBTITLE_EFFECT_SPEC_BY_ID = Object.fromEntries(
  SUBTITLE_EFFECT_SPECS.map((spec) => [spec.id, spec]),
) as Record<SubtitleEffect, SubtitleEffectSpec>;

export function subtitleMaxCharsPerLine(fontSize: number): number {
  const safeWidth = SUBTITLE_CANVAS.width - SUBTITLE_SAFE_AREA.horizontalMargin * 2;
  const outlineAllowance = 28;
  return Math.max(6, Math.min(12, Math.floor((safeWidth - outlineAllowance) / fontSize)));
}

export function subtitleMaxSegmentChars(fontSize: number): number {
  return subtitleMaxCharsPerLine(fontSize) * SUBTITLE_MAX_LINES;
}

export interface SubtitleTextLayout {
  source: string;
  lines: string[];
  lineBreakBefore?: number;
  skippedBeforeBreak: number[];
}

export function layoutSubtitleText(text: string, fontSize: number): SubtitleTextLayout {
  const source = text.replace(/\s+/g, " ").trim();
  const chars = Array.from(source);
  const max = subtitleMaxCharsPerLine(fontSize);
  if (chars.length <= max) return { source, lines: [source], skippedBeforeBreak: [] };

  let breakAt = max;
  let secondStart = max;
  for (let index = max; index > 0; index -= 1) {
    if (/\s/u.test(chars[index] ?? "")) {
      let candidateStart = index;
      while (candidateStart < chars.length && /\s/u.test(chars[candidateStart] ?? "")) candidateStart += 1;
      if (chars.length - candidateStart <= max) {
        breakAt = index;
        secondStart = candidateStart;
        break;
      }
    }
  }
  const skippedBeforeBreak: number[] = [];
  for (let index = breakAt; index < secondStart; index += 1) {
    if (/\s/u.test(chars[index] ?? "")) skippedBeforeBreak.push(index);
  }
  while (secondStart < chars.length && /\s/u.test(chars[secondStart] ?? "")) {
    skippedBeforeBreak.push(secondStart);
    secondStart += 1;
  }
  const first = chars.slice(0, breakAt).join("").trimEnd();
  const second = chars.slice(secondStart, secondStart + max).join("").trim();
  return {
    source,
    lines: second ? [first, second] : [first],
    lineBreakBefore: second ? secondStart : undefined,
    skippedBeforeBreak,
  };
}

export function subtitlePreviewText(text: string, fontSize: number): string {
  const previewSegment = Array.from(text.replace(/\s+/g, " ").trim())
    .slice(0, subtitleMaxSegmentChars(fontSize))
    .join("");
  return layoutSubtitleText(previewSegment, fontSize).lines.join("\n");
}

export function subtitleYPercent(position: SubtitleVerticalPosition): number {
  return SUBTITLE_SAFE_AREA.y[position] / SUBTITLE_CANVAS.height * 100;
}
