import { NextResponse } from "next/server";
import { addLog, createJob, failStage, jobExists, loadJob, resetDownstreamStages, saveJob, startStage } from "@/jobs/store";
import { runTtsStage } from "@/tts";
import { ElevenLabsTTSProvider } from "@/tts/elevenlabs";
import { isSupportedVoice } from "@/tts/voices";
import { voiceStorage } from "@/voices/storage";
import { ErrorCode, Job, PipelineError } from "@/shared/types";

export const runtime = "nodejs";

function reject(job: Job, errorCode: ErrorCode, message: string, context?: Record<string, unknown>, status = 400) {
  resetDownstreamStages(job, "TTS");
  startStage(job, "TTS");
  const error = {
    stage: "TTS" as const,
    error_code: errorCode,
    message,
    timestamp: new Date().toISOString(),
    context,
  };
  failStage(job, "TTS", error);
  saveJob(job);
  return NextResponse.json({ job, error: errorCode, error_code: errorCode, message }, { status });
}

export async function POST(req: Request) {
  let body: { jobId?: string; text?: string; voice?: string; provider?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY", message: "요청 본문이 올바르지 않습니다." }, { status: 400 });
  }

  const job = body.jobId && jobExists(body.jobId) ? loadJob(body.jobId) : createJob();
  const useElevenLabs = body.provider === "elevenlabs";
  const voiceId = (body.voice ?? "").trim();

  // Never trust the client's provider label alone — cross-check the voice
  // string against both namespaces so a stale/incorrect provider can't
  // silently generate with the wrong voice.
  if (useElevenLabs) {
    if (!voiceId) {
      console.debug("[TTS] rejected: elevenlabs provider with empty voiceId");
      return reject(job, "ELEVENLABS_VOICE_REQUIRED", "ElevenLabs 목소리를 선택해 주세요.");
    }
    if (isSupportedVoice(voiceId)) {
      console.debug(`[TTS] rejected: provider=elevenlabs but voiceId=${voiceId} is an Edge voice`);
      return reject(job, "TTS_PROVIDER_VOICE_MISMATCH", "ElevenLabs가 선택되었지만 Edge 목소리 ID가 전달되었습니다.", {
        provider: "elevenlabs",
        voice_id: voiceId,
      });
    }
    const entry = await voiceStorage.findByVoiceId(voiceId);
    if (!entry) {
      console.debug(`[TTS] rejected: voiceId=${voiceId} not found in ElevenLabs registry`);
      return reject(job, "VOICE_NOT_FOUND", "선택한 ElevenLabs 목소리를 찾을 수 없습니다. 등록된 목소리인지 확인해 주세요.", {
        voice_id: voiceId,
      });
    }

    console.debug(`[TTS]\nprovider=elevenlabs\nvoiceId=${entry.voiceId}\nvoiceAlias=${entry.alias}`);
    addLog(job, "TTS", "info", "[TTS] 요청 provider/voice 확정", { provider: "elevenlabs", voice_id: entry.voiceId, voice_alias: entry.alias });
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
    if (!isSupportedVoice(voiceId)) {
      const entry = await voiceStorage.findByVoiceId(voiceId);
      if (entry) {
        console.debug(`[TTS] rejected: provider=edge but voiceId=${voiceId} is a registered ElevenLabs voice (alias=${entry.alias})`);
        return reject(job, "TTS_PROVIDER_VOICE_MISMATCH", "Edge가 선택되었지만 ElevenLabs 목소리 ID가 전달되었습니다.", {
          provider: "edge",
          voice_id: voiceId,
          matched_elevenlabs_alias: entry.alias,
        });
      }
    }

    console.debug(`[TTS]\nprovider=edge\nvoiceId=${voiceId}\nvoiceAlias=`);
    addLog(job, "TTS", "info", "[TTS] 요청 provider/voice 확정", { provider: "edge", voice_id: voiceId });
    try {
      await runTtsStage(job, body.text ?? "", voiceId);
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
