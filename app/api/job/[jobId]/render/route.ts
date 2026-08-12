import { jobExists, loadJob, saveJob } from "@/jobs/store";
import { runRenderStage } from "@/render";
import type { Job } from "@/shared/types";

export const runtime = "nodejs";
export const maxDuration = 300;

function ndjson(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  if (!jobExists(jobId)) {
    return Response.json({ error: "JOB_NOT_FOUND", message: `${jobId} JOB을 찾을 수 없습니다.` }, { status: 404 });
  }
  const job = loadJob(jobId);
  if (job.stages.RENDER.status === "RUNNING") {
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

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (snapshot: Job) => controller.enqueue(ndjson({ job: snapshot }));
      try {
        await runRenderStage(job, emit);
      } catch {
        saveJob(job);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
