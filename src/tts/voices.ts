import { Voice } from "@/shared/types";

export const SUPPORTED_VOICES: Voice[] = [
  { shortName: "ko-KR-SunHiNeural", locale: "ko-KR", gender: "Female", friendlyName: "선히 (한국어, 여성)" },
  { shortName: "ko-KR-InJoonNeural", locale: "ko-KR", gender: "Male", friendlyName: "인준 (한국어, 남성)" },
  { shortName: "en-US-AriaNeural", locale: "en-US", gender: "Female", friendlyName: "Aria (English, Female)" },
  { shortName: "en-US-GuyNeural", locale: "en-US", gender: "Male", friendlyName: "Guy (English, Male)" },
];

export const DEFAULT_VOICE = SUPPORTED_VOICES[0]!.shortName;

export function isSupportedVoice(voice: string): boolean {
  return SUPPORTED_VOICES.some((v) => v.shortName === voice);
}
