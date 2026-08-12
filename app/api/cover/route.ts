import { NextResponse } from "next/server";
import { runCoverStage } from "@/cover";
import { jobExists, loadJob } from "@/jobs/store";
import type { CoverSettings } from "@/shared/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const jobId = String(form.get("jobId") ?? "").trim();
    const settingsRaw = String(form.get("settings") ?? "");
    const fileValue = form.get("file");

    if (!jobId || !jobExists(jobId) || !settingsRaw) {
      return NextResponse.json({ error: "jobId와 앞표지 설정이 필요합니다." }, { status: 400 });
    }

    const job = loadJob(jobId);
    if (job.stages.TTS.status !== "SUCCESS") {
      return NextResponse.json({ error: "TTS를 먼저 생성해 주세요." }, { status: 409 });
    }

    let settings: Omit<CoverSettings, "image">;
    try {
      settings = JSON.parse(settingsRaw) as Omit<CoverSettings, "image">;
    } catch {
      return NextResponse.json({ error: "앞표지 설정 형식이 올바르지 않습니다." }, { status: 400 });
    }

    const file = fileValue instanceof File && fileValue.size > 0
      ? {
          buffer: Buffer.from(await fileValue.arrayBuffer()),
          originalFilename: fileValue.name,
          mimeType: fileValue.type,
          size: fileValue.size,
        }
      : undefined;

    await runCoverStage(job, { file, settings });
    const status = job.stages.COVER.status === "SUCCESS" ? 200 : 422;
    return NextResponse.json({ job }, { status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "앞표지 저장에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
