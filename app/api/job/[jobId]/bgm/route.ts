import { NextResponse } from "next/server";
import { bgmStorage } from "@/bgm/storage";
import { addLog, jobExists, loadJob, saveJob } from "@/jobs/store";
import type { BgmSettings } from "@/shared/types";

export const runtime = "nodejs";

export async function POST(req: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  if (!jobExists(jobId)) {
    return NextResponse.json({ error: "JOB_NOT_FOUND", message: "JOB을 찾을 수 없습니다." }, { status: 404 });
  }

  const job = loadJob(jobId);
  try {
    const body = await req.json() as { settings?: BgmSettings };
    const settings = body.settings;
    if (!settings || typeof settings.bgmEnabled !== "boolean") {
      throw new Error("BGM 설정이 필요합니다.");
    }
    if (!Number.isFinite(settings.bgmVolume) || settings.bgmVolume < 0 || settings.bgmVolume > 1) {
      throw new Error("BGM 볼륨은 0~100% 범위여야 합니다.");
    }

    if (!settings.bgmEnabled) {
      job.bgm = { bgmEnabled: false, bgmVolume: settings.bgmVolume };
    } else {
      if (!settings.bgmId) throw new Error("BGM을 선택해 주세요.");
      const track = (await bgmStorage.listTracks()).find((candidate) => candidate.id === settings.bgmId);
      if (!track) throw new Error("선택한 BGM을 Bucket에서 찾을 수 없습니다.");
      job.bgm = {
        bgmEnabled: true,
        bgmId: track.id,
        bgmName: track.name,
        bgmVolume: settings.bgmVolume,
      };
    }

    addLog(job, "RENDER", "info", job.bgm.bgmEnabled ? "BGM 설정 저장" : "BGM 사용 안 함", {
      bgm_enabled: job.bgm.bgmEnabled,
      bgm_id: job.bgm.bgmId,
      bgm_name: job.bgm.bgmName,
      bgm_volume: job.bgm.bgmVolume,
    });
    saveJob(job);
    return NextResponse.json({ job });
  } catch (caught) {
    return NextResponse.json({
      job,
      error: "BGM_INVALID_SETTINGS",
      message: caught instanceof Error ? caught.message : String(caught),
    }, { status: 400 });
  }
}
