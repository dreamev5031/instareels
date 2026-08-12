import type { CoverFontKey } from "@/shared/types";

export interface CoverFontOption {
  key: CoverFontKey;
  label: string;
  family: string;
}

export const COVER_FONTS: CoverFontOption[] = [
  { key: "nanum-square-round", label: "나눔스퀘어라운드", family: "NanumSquareRound" },
  { key: "pretendard", label: "Pretendard", family: "Pretendard" },
  { key: "noto-sans-kr", label: "Noto Sans KR", family: "Noto Sans KR" },
  { key: "gmarket-sans", label: "G마켓 산스", family: "GmarketSansMedium" },
  { key: "tmoney-round-wind", label: "티머니 둥근바람", family: "TmoneyRoundWindExtraBold" },
  { key: "bm-dohyeon", label: "배달의민족 도현체", family: "배달의민족 도현" },
  { key: "bm-hanna", label: "배달의민족 한나체", family: "배달의민족 한나체 Pro" },
  { key: "bm-jua", label: "배달의민족 주아체", family: "배달의민족 주아" },
  { key: "score-dream-extrabold", label: "에스코어드림 ExtraBold", family: "SCoreDreamExtraBold" },
  { key: "cafe24-dangdanghae", label: "카페24 당당해체", family: "Cafe24Dangdanghae" },
  { key: "yg-jalnan", label: "여기어때 잘난체", family: "yg-jalnan" },
];

export function coverFontFamily(key: CoverFontKey): string {
  return COVER_FONTS.find((font) => font.key === key)?.family ?? "Pretendard";
}
