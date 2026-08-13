import { NextResponse } from "next/server";
import { failStage, jobExists, loadJob, saveJob } from "@/jobs/store";
import {
  MAX_UPLOAD_REQUEST_BYTES,
  runUploadStage,
  validateUploadSizes,
} from "@/upload";
import { Job, PipelineError, type ErrorCode } from "@/shared/types";
import { assertTtsReady } from "@/jobs/preconditions";

function requestJob(req: Request): Job | undefined {
  const jobId = new URL(req.url).searchParams.get("jobId");
  return jobId && jobExists(jobId) ? loadJob(jobId) : undefined;
}

function uploadFailure(
  status: number,
  errorCode: ErrorCode,
  message: string,
  options: { job?: Job; context?: Record<string, unknown>; record?: boolean } = {},
) {
  if (options.job && options.record !== false) {
    failStage(options.job, "UPLOAD", {
      stage: "UPLOAD",
      error_code: errorCode,
      message,
      context: options.context,
      timestamp: new Date().toISOString(),
    });
    saveJob(options.job);
  }
  return NextResponse.json(
    {
      stage: "UPLOAD",
      error: errorCode,
      error_code: errorCode,
      message,
      ...(options.context ? { context: options.context } : {}),
      ...(options.job ? { job: options.job } : {}),
    },
    { status },
  );
}

export async function POST(req: Request) {
  const hintedJob = requestJob(req);
  const contentLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_REQUEST_BYTES) {
    return uploadFailure(413, "UPLOAD_TOO_LARGE", "업로드 요청은 최대 200MB까지 전송할 수 있습니다.", {
      job: hintedJob,
      context: {
        limit_type: "REQUEST",
        request_size: contentLength,
        max_request_size: MAX_UPLOAD_REQUEST_BYTES,
      },
    });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (error) {
    return uploadFailure(400, "FORMDATA_PARSE_FAILED", "업로드 데이터를 읽지 못했습니다.", {
      job: hintedJob,
      context: {
        content_type: req.headers.get("content-type"),
        parse_error: error instanceof Error ? error.message : String(error),
      },
    });
  }

  const jobId = formData.get("jobId");
  if (typeof jobId !== "string" || !jobExists(jobId)) {
    return NextResponse.json(
      { stage: "UPLOAD", error: "JOB_NOT_FOUND", error_code: "JOB_NOT_FOUND", message: "TTS를 먼저 생성해주세요." },
      { status: 404 }
    );
  }

  const job = loadJob(jobId);
  try {
    assertTtsReady(job, "UPLOAD");
  } catch (error) {
    saveJob(job);
    const pipelineError = error as PipelineError;
    return uploadFailure(409, "TTS_REQUIRED", pipelineError.message, {
      job,
      context: pipelineError.context,
      record: false,
    });
  }
  if (job.stages.COVER.status !== "SUCCESS") {
    return NextResponse.json(
      { stage: "UPLOAD", error: "COVER_NOT_READY", error_code: "COVER_NOT_READY", message: "앞표지를 먼저 완성해 주세요.", job },
      { status: 400 }
    );
  }
  job.ocr_enabled = formData.get("ocrEnabled") === "true";

  const fileEntries = formData.getAll("files").filter((f): f is File => f instanceof File);
  try {
    validateUploadSizes(fileEntries.map((file) => ({
      originalFilename: file.name,
      size: file.size,
    })));
  } catch (error) {
    const pipelineError = error as PipelineError;
    return uploadFailure(413, "UPLOAD_TOO_LARGE", pipelineError.message, {
      job,
      context: pipelineError.context,
    });
  }

  const files: { originalFilename: string; buffer: Buffer }[] = [];
  try {
    for (const f of fileEntries) {
      const arrayBuffer = await f.arrayBuffer();
      files.push({ originalFilename: f.name, buffer: Buffer.from(arrayBuffer) });
    }
  } catch (error) {
    return uploadFailure(400, "FORMDATA_PARSE_FAILED", "업로드 영상 데이터를 읽지 못했습니다.", {
      job,
      context: { read_error: error instanceof Error ? error.message : String(error) },
    });
  }

  try {
    await runUploadStage(job, files);
  } catch (err) {
    if (!(err instanceof PipelineError)) {
      saveJob(job);
      return NextResponse.json({
        stage: "UPLOAD",
        error: "UNEXPECTED_ERROR",
        error_code: "UNEXPECTED_ERROR",
        message: err instanceof Error ? err.message : "업로드 중 알 수 없는 오류가 발생했습니다.",
        job,
      }, { status: 500 });
    }
    saveJob(job);
    return uploadFailure(err.code === "UPLOAD_TOO_LARGE" ? 413 : 400, err.code, err.message, {
      job,
      context: err.context,
      record: false,
    });
  }
  saveJob(job);

  return NextResponse.json({ job });
}
