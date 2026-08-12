import { NextResponse } from "next/server";
import { jobExists, loadJob } from "@/jobs/store";

export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!jobExists(jobId)) {
    return NextResponse.json({ error: "JOB_NOT_FOUND", message: `${jobId}를 찾을 수 없습니다.` }, { status: 404 });
  }
  const job = loadJob(jobId);
  return NextResponse.json({ job });
}
