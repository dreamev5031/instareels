import fs from "node:fs/promises";
import path from "node:path";
import { Job, PipelineError, SourceVideo } from "@/shared/types";
import { extractThumbnail, probeMedia } from "@/shared/ffmpeg";
import { jobSourcesDir, jobThumbsDir } from "@/jobs/paths";
import { addLog, failStage, resetDownstreamStages, startStage, succeedStage } from "@/jobs/store";
import { assertTtsReady } from "@/jobs/preconditions";

const SUPPORTED_EXTENSIONS = new Set([".mp4", ".mov"]);
export const MAX_UPLOAD_FILE_BYTES = 100_000_000;
export const MAX_UPLOAD_TOTAL_BYTES = 180_000_000;
export const MAX_UPLOAD_REQUEST_BYTES = 200_000_000;

export interface UploadFileSizeInfo {
  originalFilename: string;
  size: number;
}

export function validateUploadSizes(files: UploadFileSizeInfo[]): void {
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  const oversized = files.find((file) => file.size > MAX_UPLOAD_FILE_BYTES);
  if (oversized) {
    throw new PipelineError(
      "UPLOAD",
      "UPLOAD_TOO_LARGE",
      `개별 영상은 최대 100MB까지 업로드할 수 있습니다: ${oversized.originalFilename}`,
      {
        context: {
          limit_type: "FILE",
          filename: oversized.originalFilename,
          file_size: oversized.size,
          total_size: totalSize,
          max_file_size: MAX_UPLOAD_FILE_BYTES,
          max_total_size: MAX_UPLOAD_TOTAL_BYTES,
        },
      },
    );
  }
  if (totalSize > MAX_UPLOAD_TOTAL_BYTES) {
    throw new PipelineError(
      "UPLOAD",
      "UPLOAD_TOO_LARGE",
      "전체 영상은 합계 180MB까지 업로드할 수 있습니다.",
      {
        context: {
          limit_type: "TOTAL",
          files: files.map((file) => ({ filename: file.originalFilename, size: file.size })),
          total_size: totalSize,
          max_file_size: MAX_UPLOAD_FILE_BYTES,
          max_total_size: MAX_UPLOAD_TOTAL_BYTES,
        },
      },
    );
  }
}

export interface UploadStageDependencies {
  probeMedia: typeof probeMedia;
  extractThumbnail: typeof extractThumbnail;
}

const DEFAULT_DEPENDENCIES: UploadStageDependencies = { probeMedia, extractThumbnail };

function nextSourceId(job: Job): string {
  const n = job.sources.length + 1;
  return `SOURCE_${String(n).padStart(3, "0")}`;
}

export async function runUploadStage(
  job: Job,
  files: { originalFilename: string; buffer: Buffer }[],
  dependencyOverrides: Partial<UploadStageDependencies> = {}
): Promise<void> {
  assertTtsReady(job, "UPLOAD");
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  resetDownstreamStages(job, "UPLOAD");
  startStage(job, "UPLOAD");

  if (!files.length) {
    const error = {
      stage: "UPLOAD" as const,
      error_code: "UPLOAD_NO_FILES" as const,
      message: "업로드된 영상이 없습니다. 최소 1개 이상의 영상을 선택해주세요.",
      timestamp: new Date().toISOString(),
    };
    failStage(job, "UPLOAD", error);
    throw new PipelineError("UPLOAD", "UPLOAD_NO_FILES", error.message);
  }
  try {
    validateUploadSizes(files.map((file) => ({
      originalFilename: file.originalFilename,
      size: file.buffer.length,
    })));
  } catch (error) {
    const pipelineError = error as PipelineError;
    failStage(job, "UPLOAD", {
      stage: "UPLOAD",
      error_code: pipelineError.code,
      message: pipelineError.message,
      context: pipelineError.context,
      timestamp: new Date().toISOString(),
    });
    throw pipelineError;
  }

  const sourcesDir = jobSourcesDir(job.job_id);
  const thumbsDir = jobThumbsDir(job.job_id);
  await fs.mkdir(sourcesDir, { recursive: true });
  await fs.mkdir(thumbsDir, { recursive: true });

  try {
    for (const f of files) {
      const ext = path.extname(f.originalFilename).toLowerCase() || ".mp4";
      if (!SUPPORTED_EXTENSIONS.has(ext)) {
        throw new PipelineError(
          "UPLOAD",
          "UPLOAD_UNSUPPORTED_FORMAT",
          `지원하지 않는 영상 형식입니다: ${f.originalFilename}`,
          { context: { filename: f.originalFilename, ext } }
        );
      }

      const sourceId = nextSourceId(job);
      const targetPath = path.join(sourcesDir, `${sourceId}${ext}`);
      await fs.writeFile(targetPath, f.buffer);

      let probe;
      try {
        probe = await dependencies.probeMedia(targetPath);
      } catch (err) {
        throw new PipelineError(
          "UPLOAD",
          "UPLOAD_PROBE_FAILED",
          `영상 정보를 읽을 수 없습니다: ${f.originalFilename}`,
          { source_id: sourceId, context: { error: (err as Error).message } }
        );
      }

      const thumbPath = path.join(thumbsDir, `${sourceId}.jpg`);
      try {
        await dependencies.extractThumbnail(targetPath, thumbPath);
      } catch {
        // thumbnail is a UI nicety; missing thumbnail should not fail the stage
      }

      const source: SourceVideo = {
        source_id: sourceId,
        original_filename: f.originalFilename,
        file: targetPath,
        duration: probe.duration,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
        codec_name: probe.codecName,
        container_format: probe.containerFormat,
        status: "PENDING",
        thumbnail: thumbPath,
      };
      job.sources.push(source);
      addLog(job, "UPLOAD", "info", `${sourceId} 업로드 완료 (${probe.duration.toFixed(1)}초)`, {
        source_id: sourceId,
        original_filename: f.originalFilename,
      });
    }

    succeedStage(job, "UPLOAD");
  } catch (err) {
    const pipelineErr =
      err instanceof PipelineError
        ? err
        : new PipelineError("UPLOAD", "UPLOAD_PROBE_FAILED", (err as Error).message);
    failStage(job, "UPLOAD", {
      stage: "UPLOAD",
      error_code: pipelineErr.code,
      message: pipelineErr.message,
      source_id: pipelineErr.source_id,
      context: pipelineErr.context,
      timestamp: new Date().toISOString(),
    });
    throw pipelineErr;
  }
}
