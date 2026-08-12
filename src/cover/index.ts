import fs from "node:fs/promises";
import path from "node:path";
import { jobCoverDir } from "@/jobs/paths";
import { addLog, failStage, saveJob, startStage, succeedStage } from "@/jobs/store";
import {
  COVER_FONT_KEYS,
  CoverSettings,
  CoverVerticalPosition,
  Job,
  PipelineError,
} from "@/shared/types";

export const MAX_COVER_IMAGE_BYTES = 20 * 1024 * 1024;
const VALID_POSITIONS: CoverVerticalPosition[] = ["top", "middle", "bottom"];
const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

export interface CoverUploadInput {
  file?: {
    buffer: Buffer;
    originalFilename: string;
    mimeType: string;
    size: number;
  };
  settings: Omit<CoverSettings, "image">;
}

function coverError(code: ConstructorParameters<typeof PipelineError>[1], message: string): PipelineError {
  return new PipelineError("COVER", code, message);
}

function hasValidSignature(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === "image/jpeg") {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  return buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
}

export function validateCoverSettings(settings: Omit<CoverSettings, "image">): void {
  if (
    typeof settings.main_text !== "string" ||
    typeof settings.sub_text !== "string" ||
    typeof settings.use_same_font !== "boolean" ||
    typeof settings.shadow_enabled !== "boolean" ||
    typeof settings.stroke_enabled !== "boolean"
  ) {
    throw coverError("COVER_INVALID_SETTINGS", "앞표지 설정 형식이 올바르지 않습니다.");
  }
  if (!COVER_FONT_KEYS.includes(settings.main_font) || !COVER_FONT_KEYS.includes(settings.sub_font)) {
    throw coverError("COVER_INVALID_SETTINGS", "지원하지 않는 폰트가 선택되었습니다.");
  }
  if (!VALID_POSITIONS.includes(settings.vertical_position)) {
    throw coverError("COVER_INVALID_SETTINGS", "세로 위치는 상단, 중단, 하단 중 하나여야 합니다.");
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(settings.text_color)) {
    throw coverError("COVER_INVALID_SETTINGS", "글자색 형식이 올바르지 않습니다.");
  }
  if (settings.main_text.length > 80 || settings.sub_text.length > 120) {
    throw coverError("COVER_INVALID_SETTINGS", "메인 문구는 80자, 서브 문구는 120자까지 입력할 수 있습니다.");
  }
}

export async function runCoverStage(job: Job, input: CoverUploadInput): Promise<void> {
  startStage(job, "COVER");
  addLog(job, "COVER", "info", "앞표지 설정 저장을 시작합니다.", {
    has_new_image: Boolean(input.file),
    vertical_position: input.settings.vertical_position,
  });

  try {
    validateCoverSettings(input.settings);
    let image = job.cover.image;

    if (input.file) {
      if (input.file.size > MAX_COVER_IMAGE_BYTES) {
        throw coverError("COVER_IMAGE_TOO_LARGE", "앞표지 이미지는 최대 20MB까지 업로드할 수 있습니다.");
      }
      const extension = IMAGE_TYPES[input.file.mimeType];
      if (!extension || !hasValidSignature(input.file.buffer, input.file.mimeType)) {
        throw coverError("COVER_UNSUPPORTED_FORMAT", "JPG, PNG, WebP 이미지만 업로드할 수 있습니다.");
      }

      await fs.mkdir(jobCoverDir(job.job_id), { recursive: true });
      const filename = `cover${extension}`;
      await Promise.all(
        Object.values(IMAGE_TYPES)
          .filter((candidate) => candidate !== extension)
          .map((candidate) => fs.rm(path.join(jobCoverDir(job.job_id), `cover${candidate}`), { force: true })),
      );
      await fs.writeFile(path.join(jobCoverDir(job.job_id), filename), input.file.buffer);
      image = {
        file: path.join(jobCoverDir(job.job_id), filename),
        original_filename: input.file.originalFilename,
        mime_type: input.file.mimeType,
        size: input.file.size,
      };
    }

    if (!image) {
      throw coverError("COVER_IMAGE_REQUIRED", "앞표지 이미지를 선택해 주세요.");
    }

    job.cover = {
      ...input.settings,
      sub_font: input.settings.use_same_font ? input.settings.main_font : input.settings.sub_font,
      image,
    };
    succeedStage(job, "COVER");
    addLog(job, "COVER", "info", "앞표지 설정을 저장했습니다.", {
      filename: image.original_filename,
      image_size: image.size,
      main_font: job.cover.main_font,
      sub_font: job.cover.sub_font,
      vertical_position: job.cover.vertical_position,
    });
  } catch (caught) {
    const error = caught instanceof PipelineError
      ? caught
      : coverError("COVER_SAVE_FAILED", caught instanceof Error ? caught.message : "앞표지를 저장하지 못했습니다.");
    failStage(job, "COVER", {
      stage: "COVER",
      error_code: error.code,
      message: error.message,
      context: error.context,
      timestamp: new Date().toISOString(),
    });
  }

  saveJob(job);
}
