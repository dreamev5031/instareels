import { failStage } from "@/jobs/store";
import { Job, PipelineError, StageName } from "@/shared/types";

export function isTtsReady(job: Job): boolean {
  return (
    job.stages.TTS.status === "SUCCESS" &&
    job.tts?.status === "success" &&
    Number.isFinite(job.tts.duration) &&
    job.tts.duration > 0
  );
}

export function assertTtsReady(job: Job, stage: StageName): void {
  if (isTtsReady(job)) return;

  const message = "TTS가 생성되지 않아 영상 분석을 시작할 수 없습니다.";
  const context = {
    tts_stage_status: job.stages.TTS.status,
    tts_result_status: job.tts?.status ?? null,
    tts_duration: job.tts?.duration ?? null,
  };
  failStage(job, stage, {
    stage,
    error_code: "TTS_REQUIRED",
    message,
    context,
    timestamp: new Date().toISOString(),
  });
  throw new PipelineError(stage, "TTS_REQUIRED", message, { context });
}
