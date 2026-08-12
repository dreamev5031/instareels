import { jobExists, loadJob, saveJob } from "@/jobs/store";
import { runAnalysisPipeline } from "@/jobs/pipeline";
import { Job, PipelineError } from "@/shared/types";

function ndjson(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj) + "\n");
}

export async function POST(req: Request) {
  let body: { jobId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "INVALID_BODY" }), { status: 400 });
  }

  if (!body.jobId || !jobExists(body.jobId)) {
    return new Response(JSON.stringify({ error: "JOB_NOT_FOUND" }), { status: 404 });
  }

  const job = loadJob(body.jobId);
  if (job.stages.UPLOAD.status !== "SUCCESS") {
    return new Response(
      JSON.stringify({ error: "UPLOAD_NOT_READY", message: "영상 업로드가 완료된 뒤 분석을 시작할 수 있습니다." }),
      { status: 400 }
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (j: Job) => controller.enqueue(ndjson({ job: j }));
      try {
        await runAnalysisPipeline(job, emit);
      } catch (err) {
        if (!(err instanceof PipelineError)) {
          saveJob(job);
          emit(job);
        }
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
