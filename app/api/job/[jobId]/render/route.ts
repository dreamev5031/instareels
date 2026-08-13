import { jobExists, loadJob, saveJob } from "@/jobs/store";
import { enqueueStage, isStageQueuedOrActive } from "@/queue/jobQueue";
import { queueMaxRetries } from "@/queue/retry";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  if (!jobExists(jobId)) {
    return Response.json({ error: "JOB_NOT_FOUND", message: `${jobId} JOB을 찾을 수 없습니다.` }, { status: 404 });
  }
  const job = loadJob(jobId);
  if (job.stages.RENDER.status === "RUNNING" || (job.queue?.kind === "render" && (job.queue.status === "QUEUED" || job.queue.status === "RUNNING"))) {
    return Response.json({ stage: "RENDER", error_code: "RENDER_ALREADY_RUNNING", message: "이미 영상 렌더가 진행 중입니다.", job }, { status: 409 });
  }
  if (job.stages.VALIDATE.status !== "SUCCESS" || job.validation?.status !== "PASS") {
    return Response.json({ stage: "RENDER", error_code: "RENDER_VALIDATE_REQUIRED", message: "VALIDATE PASS 상태의 JOB만 렌더할 수 있습니다.", job }, { status: 409 });
  }
  if (job.subtitle.settings.enabled && (job.subtitle.status !== "SUCCESS" || job.subtitle.segments.length === 0)) {
    return Response.json({
      stage: "RENDER",
      substage: "SUBTITLE_GENERATION",
      error_code: "SUBTITLE_TIMING_FAILED",
      message: "자막 설정을 저장해 확정된 segment를 만든 뒤 렌더해 주세요.",
      context: { subtitle_status: job.subtitle.status, segment_count: job.subtitle.segments.length },
      job,
    }, { status: 409 });
  }

  if (await isStageQueuedOrActive("render", job.job_id)) {
    return Response.json({ stage: "RENDER", error_code: "RENDER_ALREADY_RUNNING", message: "이미 영상 렌더가 진행 중입니다.", job }, { status: 409 });
  }

  const now = new Date().toISOString();
  job.queue = { kind: "render", status: "QUEUED", queuedAt: now, currentStage: "RENDER", retryCount: 0, maxRetries: queueMaxRetries() };
  saveJob(job);

  try {
    await enqueueStage({ kind: "render", jobId: job.job_id });
  } catch {
    job.queue = undefined;
    saveJob(job);
    return Response.json(
      { job, error: "QUEUE_UNAVAILABLE", error_code: "QUEUE_UNAVAILABLE", message: "작업 큐에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요." },
      { status: 503 },
    );
  }

  return Response.json({ job, job_id: job.job_id, status: "QUEUED" }, { status: 202 });
}
