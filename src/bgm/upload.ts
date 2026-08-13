import path from "node:path";
import { BGM_AUDIO_EXTENSIONS } from "./storage";

export const MAX_BGM_UPLOAD_BYTES = 30_000_000;

export type BgmUploadErrorCode =
  | "BGM_FILE_REQUIRED"
  | "BGM_UNSUPPORTED_FORMAT"
  | "BGM_UPLOAD_TOO_LARGE"
  | "BGM_AUDIO_INVALID"
  | "BGM_BUCKET_NOT_CONFIGURED"
  | "BGM_UPLOAD_FAILED"
  | "FORMDATA_PARSE_FAILED";

export class BgmUploadError extends Error {
  constructor(
    readonly code: BgmUploadErrorCode,
    message: string,
    readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "BgmUploadError";
  }
}

export function validateBgmUpload(file: { name: string; size: number }): string {
  if (!file.name || file.size <= 0) {
    throw new BgmUploadError("BGM_FILE_REQUIRED", "업로드할 BGM 파일을 선택해 주세요.");
  }
  if (file.size > MAX_BGM_UPLOAD_BYTES) {
    throw new BgmUploadError("BGM_UPLOAD_TOO_LARGE", "BGM 파일은 최대 30MB까지 업로드할 수 있습니다.", {
      file_name: file.name,
      file_size: file.size,
      max_file_size: MAX_BGM_UPLOAD_BYTES,
    });
  }
  const extension = path.extname(file.name).toLowerCase();
  if (!BGM_AUDIO_EXTENSIONS.includes(extension as (typeof BGM_AUDIO_EXTENSIONS)[number])) {
    throw new BgmUploadError("BGM_UNSUPPORTED_FORMAT", "MP3, WAV, M4A, AAC 파일만 업로드할 수 있습니다.", {
      file_name: file.name,
      extension,
      supported_extensions: BGM_AUDIO_EXTENSIONS,
    });
  }
  return extension;
}
