import fs from "node:fs/promises";
import path from "node:path";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { PipelineError } from "@/shared/types";

export async function synthesizeSpeech(
  text: string,
  voice: string,
  outDir: string
): Promise<string> {
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const { audioFilePath } = await tts.toFile(outDir, text);
    return audioFilePath;
  } catch (err) {
    throw new PipelineError(
      "TTS",
      "TTS_GENERATION_FAILED",
      `Edge TTS 음성 생성에 실패했습니다: ${(err as Error).message}`,
      { context: { voice, textLength: text.length } }
    );
  } finally {
    tts.close();
  }
}

export async function renameTtsFile(filePath: string, outDir: string): Promise<string> {
  const ext = path.extname(filePath) || ".mp3";
  const target = path.join(outDir, `tts${ext}`);
  await fs.rename(filePath, target);
  return target;
}
