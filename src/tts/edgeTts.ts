import fs from "node:fs/promises";
import path from "node:path";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { PipelineError } from "@/shared/types";
import { probeAudioDuration } from "@/shared/ffmpeg";
import type { TtsProvider, TtsProviderOutput } from "./provider";

type EdgeMetadataItem = {
  Type?: string;
  Data?: {
    Offset?: number;
    Duration?: number;
    text?: { Text?: string; Length?: number };
  };
};

async function parseWordTiming(metadataFilePath: string | null, sourceText: string, duration: number) {
  if (!metadataFilePath) return [];
  const parsed = JSON.parse(await fs.readFile(metadataFilePath, "utf8")) as { Metadata?: EdgeMetadataItem[] };
  let searchFrom = 0;
  return (parsed.Metadata ?? [])
    .filter((item) => item.Type === "WordBoundary" && item.Data?.text?.Text)
    .map((item) => {
      const text = String(item.Data!.text!.Text);
      const found = sourceText.indexOf(text, searchFrom);
      const textStart = found >= 0 ? found : searchFrom;
      const textEnd = textStart + text.length;
      searchFrom = textEnd;
      const start = Math.max(0, Number(item.Data!.Offset ?? 0) / 10_000_000);
      const wordDuration = Math.max(0.01, Number(item.Data!.Duration ?? 0) / 10_000_000);
      return { text, start: Math.min(duration, start), end: Math.min(duration, start + wordDuration), text_start: textStart, text_end: textEnd };
    })
    .filter((item) => item.end > item.start);
}

export async function synthesizeSpeech(
  text: string,
  voice: string,
  outDir: string
): Promise<string> {
  const maxAttempts = 2;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const tts = new MsEdgeTTS();
    try {
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, {
        wordBoundaryEnabled: true,
        sentenceBoundaryEnabled: true,
      });
      const { audioFilePath } = await tts.toFile(outDir, text);
      return audioFilePath;
    } catch (err) {
      lastError = err as Error;
      const retryable = /No audio data received|ECONN|WebSocket|429|timed?\s*out/i.test(lastError.message);
      if (!retryable || attempt === maxAttempts) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    } finally {
      tts.close();
    }
  }

  throw new PipelineError(
    "TTS",
    "TTS_GENERATION_FAILED",
    `Edge TTS 음성 생성에 실패했습니다: ${lastError?.message ?? "unknown error"}`,
    { context: { voice, textLength: text.length, attempts: maxAttempts } }
  );
}

export async function renameTtsFile(filePath: string, outDir: string): Promise<string> {
  const ext = path.extname(filePath) || ".mp3";
  const target = path.join(outDir, `tts${ext}`);
  await fs.rename(filePath, target);
  return target;
}

export class EdgeTTSProvider implements TtsProvider {
  readonly name = "edge" as const;

  async synthesize(text: string, voice: string, outputDir: string): Promise<TtsProviderOutput> {
    const maxAttempts = 2;
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const tts = new MsEdgeTTS();
      try {
        await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, {
          wordBoundaryEnabled: true,
          sentenceBoundaryEnabled: true,
        });
        const generated = await tts.toFile(outputDir, text);
        const audioPath = await renameTtsFile(generated.audioFilePath, outputDir);
        const duration = await probeAudioDuration(audioPath);
        if (!(duration > 0)) throw new Error("생성된 오디오 duration을 측정하지 못했습니다.");
        const words = await parseWordTiming(generated.metadataFilePath, text, duration);
        return {
          provider: this.name,
          audioPath,
          duration,
          timing: { source: words.length ? "provider_word" : "duration_fallback", words },
        };
      } catch (error) {
        lastError = error as Error;
        const retryable = /No audio data received|No metadata received|ECONN|WebSocket|429|timed?\s*out/i.test(lastError.message);
        if (!retryable || attempt === maxAttempts) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      } finally {
        tts.close();
      }
    }
    throw new PipelineError("TTS", "TTS_GENERATION_FAILED", `Edge TTS 음성 생성에 실패했습니다: ${lastError?.message ?? "unknown error"}`, {
      context: { voice, textLength: text.length, attempts: maxAttempts, provider: this.name },
    });
  }
}
