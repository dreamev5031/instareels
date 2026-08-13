import { NextResponse } from "next/server";
import { jobExists, loadJob, saveJob } from "@/jobs/store";
import { assertTtsReady } from "@/jobs/preconditions";
import { PipelineError } from "@/shared/types";
import { enqueueStage, isStageQueuedOrActive } from "@/queue/jobQueue";
import { queueMaxRetries } from "@/queue/retry";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { jobId?: string; ocrEnabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  if (!body.jobId || !jobExists(body.jobId)) {
    return NextResponse.json({ error: "JOB_NOT_FOUND" }, { status: 404 });
  }

  const job = loadJob(body.jobId);
  job.ocr_enabled = body.ocrEnabled === true;

  if (job.queue?.kind === "analyze" && (job.queue.status === "QUEUED" || job.queue.status === "RUNNING")) {
    return NextResponse.json(
      { job, error: "JOB_ALREADY_QUEUED", error_code: "JOB_ALREADY_QUEUED", message: "이미 영상 분석이 진행 중입니다." },
      { status: 409 },
    );
  }

  try {
    assertTtsReady(job, "OCR");
  } catch (error) {
    saveJob(job);
    const pipelineError = error as PipelineError;
    return NextResponse.json(
      { stage: "OCR", error: "TTS_REQUIRED", error_code: "TTS_REQUIRED", message: pipelineError.message, job },
      { status: 409 },
    );
  }
  if (job.stages.COVER.status !== "SUCCESS") {
    return NextResponse.json({ error: "COVER_NOT_READY", message: "앞표지를 먼저 완성해 주세요." }, { status: 400 });
  }
  if (job.stages.UPLOAD.status !== "SUCCESS") {
    return NextResponse.json({ error: "UPLOAD_NOT_READY", message: "영상 업로드가 완료된 뒤 분석을 시작할 수 있습니다." }, { status: 400 });
  }

  if (await isStageQueuedOrActive("analyze", job.job_id)) {
    return NextResponse.json(
      { job, error: "JOB_ALREADY_QUEUED", error_code: "JOB_ALREADY_QUEUED", message: "이미 영상 분석이 진행 중입니다." },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  job.queue = { kind: "analyze", status: "QUEUED", queuedAt: now, retryCount: 0, maxRetries: queueMaxRetries() };
  saveJob(job);

  try {
    await enqueueStage({ kind: "analyze", jobId: job.job_id, ocrEnabled: job.ocr_enabled });
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
