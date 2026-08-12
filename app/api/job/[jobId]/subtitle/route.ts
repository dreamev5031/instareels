import { NextResponse } from "next/server";
import { jobExists, loadJob } from "@/jobs/store";
import { saveSubtitleSettings } from "@/subtitle";
import type { SubtitleSettings } from "@/shared/types";

export async function POST(req: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  if (!jobExists(jobId)) return NextResponse.json({ error: "JOB_NOT_FOUND", message: "JOB을 찾을 수 없습니다." }, { status: 404 });
  const job = loadJob(jobId);
  try {
    const body = await req.json() as { settings?: SubtitleSettings };
    if (!body.settings) throw new Error("자막 설정이 필요합니다.");
    saveSubtitleSettings(job, body.settings);
    return NextResponse.json({ job });
  } catch (caught) {
    return NextResponse.json({ job, error: "SUBTITLE_INVALID_SETTINGS", message: caught instanceof Error ? caught.message : String(caught) }, { status: 400 });
  }
}
