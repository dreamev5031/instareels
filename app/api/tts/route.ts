import { NextResponse } from "next/server";
import { createJob, jobExists, loadJob, saveJob } from "@/jobs/store";
import { runTtsStage } from "@/tts";
import { PipelineError } from "@/shared/types";

export async function POST(req: Request) {
  let body: { jobId?: string; text?: string; voice?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY", message: "요청 본문이 올바르지 않습니다." }, { status: 400 });
  }

  const job = body.jobId && jobExists(body.jobId) ? loadJob(body.jobId) : createJob();

  try {
    await runTtsStage(job, body.text ?? "", body.voice ?? "");
  } catch (err) {
    if (!(err instanceof PipelineError)) {
      saveJob(job);
      return NextResponse.json({ error: "UNEXPECTED_ERROR", message: (err as Error).message, job }, { status: 500 });
    }
  }
  saveJob(job);

  return NextResponse.json({ job });
}
