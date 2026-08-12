import fs from "node:fs/promises";
import path from "node:path";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { PipelineError } from "@/shared/types";

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
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
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
