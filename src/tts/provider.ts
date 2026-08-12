import type { TtsProviderName, TtsTimingData } from "@/shared/types";

export interface TtsProviderOutput {
  provider: TtsProviderName;
  audioPath: string;
  duration: number;
  timing: TtsTimingData;
}

export interface TtsProvider {
  readonly name: TtsProviderName;
  synthesize(text: string, voice: string, outputDir: string): Promise<TtsProviderOutput>;
}

