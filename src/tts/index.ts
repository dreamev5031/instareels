import { Job, PipelineError, TtsResult } from "@/shared/types";
import { probeAudioDuration } from "@/shared/ffmpeg";
import { jobTtsDir } from "@/jobs/paths";
import { addLog, failStage, resetDownstreamStages, startStage, succeedStage } from "@/jobs/store";
import { synthesizeSpeech, renameTtsFile } from "./edgeTts";
import { isSupportedVoice } from "./voices";

export interface TtsStageDependencies {
  synthesizeSpeech: typeof synthesizeSpeech;
  renameTtsFile: typeof renameTtsFile;
  probeAudioDuration: typeof probeAudioDuration;
}

const DEFAULT_DEPENDENCIES: TtsStageDependencies = {
  synthesizeSpeech,
  renameTtsFile,
  probeAudioDuration,
};

export async function runTtsStage(
  job: Job,
  text: string,
  voice: string,
  dependencyOverrides: Partial<TtsStageDependencies> = {}
): Promise<void> {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  resetDownstreamStages(job, "TTS");
  startStage(job, "TTS");

  const trimmed = text.trim();
  if (!trimmed) {
    const error = {
      stage: "TTS" as const,
      error_code: "TTS_EMPTY_TEXT" as const,
      message: "TTS 텍스트가 비어 있습니다. 나레이션 텍스트를 입력해주세요.",
      timestamp: new Date().toISOString(),
    };
    failStage(job, "TTS", error);
    throw new PipelineError("TTS", "TTS_EMPTY_TEXT", error.message);
  }

  if (!isSupportedVoice(voice)) {
    const error = {
      stage: "TTS" as const,
      error_code: "TTS_GENERATION_FAILED" as const,
      message: `지원하지 않는 voice입니다: ${voice}`,
      timestamp: new Date().toISOString(),
      context: { voice },
    };
    failStage(job, "TTS", error);
    throw new PipelineError("TTS", "TTS_GENERATION_FAILED", error.message);
  }

  try {
    const outDir = jobTtsDir(job.job_id);
    const rawPath = await dependencies.synthesizeSpeech(trimmed, voice, outDir);
    const file = await dependencies.renameTtsFile(rawPath, outDir);
    const duration = await dependencies.probeAudioDuration(file);

    if (!duration || duration <= 0) {
      throw new PipelineError(
        "TTS",
        "TTS_PROBE_FAILED",
        "생성된 오디오 파일의 길이를 측정할 수 없습니다.",
        { context: { file } }
      );
    }

    const result: TtsResult = {
      status: "success",
      text: trimmed,
      voice,
      file,
      duration,
    };
    job.tts = result;
    addLog(job, "TTS", "info", `TTS 생성 완료: ${duration.toFixed(2)}초`, { voice, duration });
    succeedStage(job, "TTS");
  } catch (err) {
    const pipelineErr =
      err instanceof PipelineError
        ? err
        : new PipelineError("TTS", "TTS_GENERATION_FAILED", (err as Error).message);
    failStage(job, "TTS", {
      stage: "TTS",
      error_code: pipelineErr.code,
      message: pipelineErr.message,
      context: pipelineErr.context,
      timestamp: new Date().toISOString(),
    });
    throw pipelineErr;
  }
}
