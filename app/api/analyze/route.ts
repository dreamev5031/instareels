import { jobExists, loadJob, saveJob } from "@/jobs/store";
import { runAnalysisPipeline } from "@/jobs/pipeline";
import { Job, PipelineError } from "@/shared/types";
import { assertTtsReady } from "@/jobs/preconditions";

function ndjson(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj) + "\n");
}

export async function POST(req: Request) {
  let body: { jobId?: string; ocrEnabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "INVALID_BODY" }), { status: 400 });
  }

  if (!body.jobId || !jobExists(body.jobId)) {
    return new Response(JSON.stringify({ error: "JOB_NOT_FOUND" }), { status: 404 });
  }

  const job = loadJob(body.jobId);
  job.ocr_enabled = body.ocrEnabled === true;
  try {
    assertTtsReady(job, "OCR");
  } catch (error) {
    saveJob(job);
    const pipelineError = error as PipelineError;
    return new Response(
      JSON.stringify({
        stage: "OCR",
        error: "TTS_REQUIRED",
        error_code: "TTS_REQUIRED",
        message: pipelineError.message,
        job,
      }),
      { status: 409, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  }
  if (job.stages.COVER.status !== "SUCCESS") {
    return new Response(
      JSON.stringify({ error: "COVER_NOT_READY", message: "앞표지를 먼저 완성해 주세요." }),
      { status: 400 }
    );
  }
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
