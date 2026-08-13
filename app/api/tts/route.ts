import { NextResponse } from "next/server";
import { addLog, createJob, failStage, jobExists, loadJob, resetDownstreamStages, saveJob, startStage } from "@/jobs/store";
import { isSupportedVoice } from "@/tts/voices";
import { voiceStorage } from "@/voices/storage";
import { enqueueStage, isStageQueuedOrActive } from "@/queue/jobQueue";
import { queueMaxRetries } from "@/queue/retry";
import { ErrorCode, Job } from "@/shared/types";

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

  if (job.queue?.kind === "tts" && (job.queue.status === "QUEUED" || job.queue.status === "RUNNING")) {
    return NextResponse.json(
      { job, error: "JOB_ALREADY_QUEUED", error_code: "JOB_ALREADY_QUEUED", message: "이미 TTS 생성이 진행 중입니다." },
      { status: 409 },
    );
  }

  const text = (body.text ?? "").trim();
  if (!text) {
    return reject(job, "TTS_EMPTY_TEXT", "TTS 텍스트가 비어 있습니다. 나레이션 텍스트를 입력해주세요.");
  }

  const useElevenLabs = body.provider === "elevenlabs";
  const voiceId = (body.voice ?? "").trim();

  // Never trust the client's provider label alone — cross-check the voice
  // string against both namespaces so a stale/incorrect provider can't
  // silently generate with the wrong voice. This all runs synchronously
  // before anything is queued, so an obviously-bad request fails fast
  // with a normal 4xx instead of round-tripping through the worker.
  let voiceAlias: string | undefined;
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
    voiceAlias = entry.alias;
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
  }

  console.debug(`[TTS]\nprovider=${useElevenLabs ? "elevenlabs" : "edge"}\nvoiceId=${voiceId}\nvoiceAlias=${voiceAlias ?? ""}`);
  addLog(job, "TTS", "info", "[TTS] 요청 provider/voice 확정 — 큐에 등록", {
    provider: useElevenLabs ? "elevenlabs" : "edge",
    voice_id: voiceId,
    voice_alias: voiceAlias,
  });

  // Guard against double-processing before it even reaches BullMQ's own
  // jobId-based dedup: a second submit for the same JOB while queued/active
  // was already rejected above by the job.queue.status check.
  if (await isStageQueuedOrActive("tts", job.job_id)) {
    return NextResponse.json(
      { job, error: "JOB_ALREADY_QUEUED", error_code: "JOB_ALREADY_QUEUED", message: "이미 TTS 생성이 진행 중입니다." },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  job.queue = { kind: "tts", status: "QUEUED", queuedAt: now, retryCount: 0, maxRetries: queueMaxRetries() };
  saveJob(job);

  try {
    await enqueueStage({ kind: "tts", jobId: job.job_id, text, voice: voiceId, provider: useElevenLabs ? "elevenlabs" : "edge", voiceAlias });
  } catch {
    job.queue = undefined;
    saveJob(job);
    return NextResponse.json(
      { job, error: "QUEUE_UNAVAILABLE", error_code: "QUEUE_UNAVAILABLE", message: "작업 큐에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요." },
      { status: 503 },
    );
  }

  return NextResponse.json({ job, job_id: job.job_id, status: "QUEUED" }, { status: 202 });
}
