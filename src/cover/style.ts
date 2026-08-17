export const COVER_CANVAS_WIDTH = 1080;
export const COVER_CANVAS_HEIGHT = 1920;

// Legacy insta-ad-generator cover defaults. Keep preview and ffmpeg render
// derived from this single source so the two cannot drift independently.
export const COVER_TEXT_STYLE = {
  safeMarginX: 64,
  safeMarginY: 72,
  mainFontSize: 112,
  subFontSize: 64,
  mainLineHeightRatio: 1.12,
  subLineHeightRatio: 1.18,
  subGapRatio: 0.52,
  minGap: 28,
  verticalCenterPercent: {
    top: 19,
    middle: 50,
    bottom: 80,
  },
  mainMaxCharacters: 8,
  subMaxCharacters: 15,
} as const;

export function coverMainLineHeight(): number {
  return COVER_TEXT_STYLE.mainFontSize * COVER_TEXT_STYLE.mainLineHeightRatio;
}

export function coverSubLineHeight(): number {
  return COVER_TEXT_STYLE.subFontSize * COVER_TEXT_STYLE.subLineHeightRatio;
}

export function coverTextGap(): number {
  return Math.max(COVER_TEXT_STYLE.minGap, COVER_TEXT_STYLE.subFontSize * COVER_TEXT_STYLE.subGapRatio);
}

export function coverVerticalCenterPercent(position: keyof typeof COVER_TEXT_STYLE.verticalCenterPercent): number {
  return COVER_TEXT_STYLE.verticalCenterPercent[position];
}

export function coverPreviewCqw(px: number): string {
  return `${(px / COVER_CANVAS_WIDTH) * 100}cqw`;
}

export function wrapCoverText(text: string, maxCharacters: number): string[] {
  const paragraphs = text.trim() ? text.trim().split(/\r?\n/) : [];
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    let current = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (Array.from(candidate).length <= maxCharacters) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      const characters = Array.from(word);
      while (characters.length > maxCharacters) lines.push(characters.splice(0, maxCharacters).join(""));
      current = characters.join("");
    }
    if (current) lines.push(current);
  }
  return lines;
}
