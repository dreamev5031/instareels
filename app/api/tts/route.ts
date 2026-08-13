import { NextResponse } from "next/server";
import { createJob, failStage, jobExists, loadJob, resetDownstreamStages, saveJob, startStage } from "@/jobs/store";
import { runTtsStage } from "@/tts";
import { ElevenLabsTTSProvider } from "@/tts/elevenlabs";
import { voiceStorage } from "@/voices/storage";
import { PipelineError } from "@/shared/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { jobId?: string; text?: string; voice?: string; provider?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY", message: "요청 본문이 올바르지 않습니다." }, { status: 400 });
  }

  const job = body.jobId && jobExists(body.jobId) ? loadJob(body.jobId) : createJob();
  const useElevenLabs = body.provider === "elevenlabs";

  if (useElevenLabs) {
    const voiceId = body.voice ?? "";
    const entry = await voiceStorage.findByVoiceId(voiceId);
    if (!entry) {
      resetDownstreamStages(job, "TTS");
      startStage(job, "TTS");
      const error = {
        stage: "TTS" as const,
        error_code: "VOICE_NOT_FOUND" as const,
        message: "선택한 ElevenLabs 목소리를 찾을 수 없습니다. 등록된 목소리인지 확인해 주세요.",
        timestamp: new Date().toISOString(),
        context: { voice_id: voiceId },
      };
      failStage(job, "TTS", error);
      saveJob(job);
      return NextResponse.json({ job, error: "VOICE_NOT_FOUND", error_code: "VOICE_NOT_FOUND", message: error.message }, { status: 400 });
    }

    try {
      await runTtsStage(job, body.text ?? "", entry.voiceId, { provider: new ElevenLabsTTSProvider() });
      if (job.tts) job.tts.voice_alias = entry.alias;
    } catch (err) {
      if (!(err instanceof PipelineError)) {
        saveJob(job);
        return NextResponse.json({ error: "UNEXPECTED_ERROR", message: (err as Error).message, job }, { status: 500 });
      }
    }
  } else {
    try {
      await runTtsStage(job, body.text ?? "", body.voice ?? "");
    } catch (err) {
      if (!(err instanceof PipelineError)) {
        saveJob(job);
        return NextResponse.json({ error: "UNEXPECTED_ERROR", message: (err as Error).message, job }, { status: 500 });
      }
    }
  }
  saveJob(job);

  return NextResponse.json({ job });
}
