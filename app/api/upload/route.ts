import { NextResponse } from "next/server";
import { jobExists, loadJob, saveJob } from "@/jobs/store";
import { runUploadStage } from "@/upload";
import { PipelineError } from "@/shared/types";

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
  if (job.stages.TTS.status !== "SUCCESS") {
    return NextResponse.json(
      { error: "TTS_NOT_READY", message: "TTS가 성공적으로 생성된 뒤 영상을 업로드할 수 있습니다." },
      { status: 400 }
    );
  }
  if (job.stages.COVER.status !== "SUCCESS") {
    return NextResponse.json(
      { error: "COVER_NOT_READY", message: "앞표지를 먼저 완성해 주세요." },
      { status: 400 }
    );
  }

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
