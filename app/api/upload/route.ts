import { NextResponse } from "next/server";
import { jobExists, loadJob, saveJob } from "@/jobs/store";
import { runUploadStage } from "@/upload";
import { PipelineError } from "@/shared/types";
import { assertTtsReady } from "@/jobs/preconditions";

export async function POST(req: Request) {
  const formData = await req.formData();
  const jobId = formData.get("jobId");
  if (typeof jobId !== "string" || !jobExists(jobId)) {
    return NextResponse.json(
      { error: "JOB_NOT_FOUND", message: "TTS를 먼저 생성해주세요." },
      { status: 404 }
    );
  }

  const job = loadJob(jobId);
  try {
    assertTtsReady(job, "UPLOAD");
  } catch (error) {
    saveJob(job);
    const pipelineError = error as PipelineError;
    return NextResponse.json(
      { stage: "UPLOAD", error: "TTS_REQUIRED", error_code: "TTS_REQUIRED", message: pipelineError.message, job },
      { status: 409 }
    );
  }
  if (job.stages.COVER.status !== "SUCCESS") {
    return NextResponse.json(
      { error: "COVER_NOT_READY", message: "앞표지를 먼저 완성해 주세요." },
      { status: 400 }
    );
  }
  job.ocr_enabled = formData.get("ocrEnabled") === "true";

  const fileEntries = formData.getAll("files").filter((f): f is File => f instanceof File);
  const files: { originalFilename: string; buffer: Buffer }[] = [];
  for (const f of fileEntries) {
    const arrayBuffer = await f.arrayBuffer();
    files.push({ originalFilename: f.name, buffer: Buffer.from(arrayBuffer) });
  }

  try {
    await runUploadStage(job, files);
  } catch (err) {
    if (!(err instanceof PipelineError)) {
      saveJob(job);
      return NextResponse.json({ error: "UNEXPECTED_ERROR", message: (err as Error).message, job }, { status: 500 });
    }
  }
  saveJob(job);

  return NextResponse.json({ job });
}
