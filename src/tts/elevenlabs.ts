import fs from "node:fs/promises";
import path from "node:path";
import { PipelineError, type TtsWordTiming } from "@/shared/types";
import { probeAudioDuration } from "@/shared/ffmpeg";
import {
  ElevenLabsApiError,
  elevenLabsModelId,
  synthesizeElevenLabsSpeech,
  type ElevenLabsAlignment,
} from "@/elevenlabs/client";
import type { TtsProvider, TtsProviderOutput } from "./provider";

/** Groups ElevenLabs' character-level alignment into word-level timings by
 *  splitting on whitespace runs, mirroring how Edge's WordBoundary events
 *  are turned into words in edgeTts.ts. text_start/text_end are character
 *  offsets into the character stream ElevenLabs echoed back, which is the
 *  exact text sent to synthesize() (job.tts.text) — the same contract
 *  buildSubtitleSegments() already relies on for Edge. */
export function alignmentToWordTimings(alignment: ElevenLabsAlignment, duration: number): TtsWordTiming[] {
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment;
  const words: TtsWordTiming[] = [];
  let current: { text: string; start: number; end: number; text_start: number } | null = null;

  const flush = () => {
    if (!current) return;
    words.push({
      text: current.text,
      start: current.start,
      end: current.end,
      text_start: current.text_start,
      text_end: current.text_start + current.text.length,
    });
    current = null;
  };

  for (let index = 0; index < characters.length; index += 1) {
    const ch = characters[index] ?? "";
    if (!ch || /\s/.test(ch)) {
      flush();
      continue;
    }
    const start = Math.max(0, starts[index] ?? 0);
    const end = Math.max(start, ends[index] ?? start);
    if (!current) current = { text: ch, start, end, text_start: index };
    else {
      current.text += ch;
      current.end = end;
    }
  }
  flush();

  return words
    .map((word) => ({ ...word, start: Math.min(duration, word.start), end: Math.min(duration, word.end) }))
    .filter((word) => word.end > word.start);
}

export class ElevenLabsTTSProvider implements TtsProvider {
  readonly name = "elevenlabs" as const;

  async synthesize(text: string, voiceId: string, outputDir: string): Promise<TtsProviderOutput> {
    const modelId = elevenLabsModelId();
    let result;
    try {
      result = await synthesizeElevenLabsSpeech(voiceId, text, modelId);
    } catch (caught) {
      if (caught instanceof ElevenLabsApiError) {
        throw new PipelineError("TTS", caught.code, caught.message, {
          context: { voice: voiceId, model_id: modelId, http_status: caught.status },
        });
      }
      throw new PipelineError("TTS", "ELEVENLABS_API_ERROR", caught instanceof Error ? caught.message : String(caught), {
        context: { voice: voiceId, model_id: modelId },
      });
    }

    await fs.mkdir(outputDir, { recursive: true });
    const audioPath = path.join(outputDir, "tts.mp3");
    await fs.writeFile(audioPath, result.audio);

    const duration = await probeAudioDuration(audioPath);
    if (!(duration > 0)) {
      throw new PipelineError("TTS", "TTS_PROBE_FAILED", "ElevenLabs 오디오의 길이를 측정하지 못했습니다.", {
        context: { voice: voiceId, model_id: modelId },
      });
    }

    if (!result.alignment || !result.alignment.characters?.length) {
      throw new PipelineError(
        "TTS",
        "TIMESTAMP_MISSING",
        "ElevenLabs 응답에 timestamp(alignment) 데이터가 없어 자막 타이밍을 만들 수 없습니다.",
        { context: { voice: voiceId, model_id: modelId } },
      );
    }

    let words: TtsWordTiming[];
    try {
      words = alignmentToWordTimings(result.alignment, duration);
    } catch (caught) {
      throw new PipelineError("TTS", "TIMESTAMP_PARSE_FAILED", "ElevenLabs timestamp 데이터를 word timing으로 변환하지 못했습니다.", {
        context: { voice: voiceId, error: caught instanceof Error ? caught.message : String(caught) },
      });
    }
    if (!words.length) {
      throw new PipelineError("TTS", "TIMESTAMP_PARSE_FAILED", "ElevenLabs timestamp에서 단어 단위 timing을 만들지 못했습니다.", {
        context: { voice: voiceId, character_count: result.alignment.characters.length },
      });
    }

    return {
      provider: this.name,
      audioPath,
      duration,
      timing: { source: "provider_word", words },
    };
  }
}
