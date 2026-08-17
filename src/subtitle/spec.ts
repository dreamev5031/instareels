import type { SubtitleEffect, SubtitleVerticalPosition } from "@/shared/types";

export const SUBTITLE_CANVAS = { width: 1080, height: 1920 } as const;
export const SUBTITLE_SAFE_AREA = {
  horizontalMargin: 64,
  maxWidthRatio: 0.88,
  centerX: 540,
  y: { top: 360, middle: 960, bottom: 1510 } satisfies Record<SubtitleVerticalPosition, number>,
} as const;
export const SUBTITLE_CURSOR_BLINK_MS = 500;
export const SUBTITLE_LINE_HEIGHT = 1.22;
export const SUBTITLE_MAX_LINES = 2;
export const SUBTITLE_PINK_ASS = "&H00B34FFF&";
export const SUBTITLE_EASE_OUT_CUBIC = 0.33;

export type SubtitleAnimationUnit = "character" | "word" | "phrase" | "character_accent";
export type SubtitleEffectMode =
  | "typewriter"
  | "rushed_typing"
  | "copybook"
  | "flat_popout"
  | "word_zoom"
  | "breeze"
  | "transparent_gradient"
  | "pink_blink"
  | "easy_slide";

export interface SubtitleEffectSpec {
  id: SubtitleEffect;
  label: string;
  mode: SubtitleEffectMode;
  animationUnit: SubtitleAnimationUnit;
  previewClass: string;
}

export const SUBTITLE_EFFECT_SPECS: readonly SubtitleEffectSpec[] = [
  { id: "typewriter", label: "타자기", mode: "typewriter", animationUnit: "character", previewClass: "subtitle-effect-typewriter" },
  { id: "rushed_typing", label: "성급한 타이핑", mode: "rushed_typing", animationUnit: "character", previewClass: "subtitle-effect-rushed_typing" },
  { id: "copybook", label: "카피북", mode: "copybook", animationUnit: "character", previewClass: "subtitle-effect-copybook" },
  { id: "flat_popout", label: "플랫 팝아웃", mode: "flat_popout", animationUnit: "character", previewClass: "subtitle-effect-flat_popout" },
  { id: "word_zoom", label: "단어 줌", mode: "word_zoom", animationUnit: "word", previewClass: "subtitle-effect-word_zoom" },
  { id: "breeze", label: "산들바람", mode: "breeze", animationUnit: "phrase", previewClass: "subtitle-effect-breeze" },
  { id: "transparent_gradient", label: "투명한 구배", mode: "transparent_gradient", animationUnit: "phrase", previewClass: "subtitle-effect-transparent_gradient" },
  { id: "pink_blink", label: "핑크 블링크", mode: "pink_blink", animationUnit: "character_accent", previewClass: "subtitle-effect-pink_blink" },
  { id: "easy_slide", label: "이지 슬라이드", mode: "easy_slide", animationUnit: "phrase", previewClass: "subtitle-effect-easy_slide" },
] as const;

export const SUBTITLE_EFFECT_SPEC_BY_ID = Object.fromEntries(
  SUBTITLE_EFFECT_SPECS.map((spec) => [spec.id, spec]),
) as Record<SubtitleEffect, SubtitleEffectSpec>;

export const SUBTITLE_EFFECT_TIMING = {
  copybookMotionMs: 480,
  flatPopPeakMs: 200,
  flatPopSettleMs: 340,
  wordZoomMinMs: 160,
  wordZoomMaxMs: 360,
  wordZoomScalePercent: 118,
  breezeMinMs: 220,
  breezeMaxMs: 650,
  gradientMinMs: 280,
  gradientMaxMs: 900,
  easySlideMinMs: 220,
  easySlideMaxMs: 520,
  pinkMinMs: 90,
  pinkMaxMs: 220,
} as const;

export function subtitleMaxCharsPerLine(fontSize: number): number {
  const safeWidth = SUBTITLE_CANVAS.width * SUBTITLE_SAFE_AREA.maxWidthRatio;
  const outlineAllowance = 36;
  // Conservative fallback used before libass/font metrics are available.
  // Final ASS always preserves full-layout geometry with a hidden suffix.
  return Math.max(5, Math.min(12, Math.floor((safeWidth - outlineAllowance) / fontSize)));
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
