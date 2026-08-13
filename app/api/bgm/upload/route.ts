import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { bgmStorage } from "@/bgm/storage";
import {
  BgmUploadError,
  MAX_BGM_UPLOAD_BYTES,
  validateBgmUpload,
  type BgmUploadErrorCode,
} from "@/bgm/upload";
import { probeAudioMedia } from "@/shared/ffmpeg";

export const runtime = "nodejs";
export const maxDuration = 60;

function failure(status: number, errorCode: BgmUploadErrorCode, message: string, context?: Record<string, unknown>) {
  return NextResponse.json({
    stage: "BGM_UPLOAD",
    error: errorCode,
    error_code: errorCode,
    message,
    ...(context ? { context } : {}),
  }, { status });
}

export async function POST(req: Request) {
  const contentLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BGM_UPLOAD_BYTES + 1_000_000) {
    return failure(413, "BGM_UPLOAD_TOO_LARGE", "BGM 파일은 최대 30MB까지 업로드할 수 있습니다.", {
      request_size: contentLength,
      max_file_size: MAX_BGM_UPLOAD_BYTES,
    });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (caught) {
    return failure(400, "FORMDATA_PARSE_FAILED", "BGM 업로드 데이터를 읽지 못했습니다.", {
      parse_error: caught instanceof Error ? caught.message : String(caught),
    });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return failure(400, "BGM_FILE_REQUIRED", "업로드할 BGM 파일을 선택해 주세요.");
  }

  let extension: string;
  try {
    extension = validateBgmUpload(file);
  } catch (caught) {
    const error = caught as BgmUploadError;
    return failure(error.code === "BGM_UPLOAD_TOO_LARGE" ? 413 : 400, error.code, error.message, error.context);
  }

  if (!bgmStorage.isConfigured()) {
    return failure(503, "BGM_BUCKET_NOT_CONFIGURED", "BGM 저장소가 연결되지 않았습니다.");
  }

  const temporaryFile = path.join(os.tmpdir(), `instareels-bgm-${randomUUID()}${extension}`);
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(temporaryFile, buffer);

    let probe;
    try {
      probe = await probeAudioMedia(temporaryFile);
    } catch (caught) {
      return failure(400, "BGM_AUDIO_INVALID", "유효한 오디오 스트림을 확인하지 못했습니다.", {
        file_name: file.name,
        probe_error: caught instanceof Error ? caught.message : String(caught),
      });
    }

    const track = await bgmStorage.uploadTrack({
      originalFilename: file.name,
      buffer,
      durationSeconds: probe.duration,
      codecName: probe.codecName,
    });
    return NextResponse.json({
      stage: "BGM_UPLOAD",
      message: "BGM 업로드 완료",
      track,
      tracks: await bgmStorage.listTracks(),
    });
  } catch (caught) {
    return failure(500, "BGM_UPLOAD_FAILED", "BGM을 Railway Bucket에 저장하지 못했습니다.", {
      file_name: file.name,
      upload_error: caught instanceof Error ? caught.message : String(caught),
    });
  } finally {
    await fs.rm(temporaryFile, { force: true }).catch(() => {});
  }
}
