import fs from "node:fs/promises";
import { Job, OcrBlockReason, OcrSegment, PipelineError } from "@/shared/types";
import { extractFrames } from "@/shared/ffmpeg";
import { jobFramesDir } from "@/jobs/paths";
import { addLog, failStage, resetDownstreamStages, startStage, succeedStage } from "@/jobs/store";
import { OcrEngine } from "./engine";
import { TesseractOcrEngine } from "./tesseractEngine";

const SAMPLE_INTERVAL_SECONDS = 1.0;
const MIN_TEXT_LENGTH = 2;
const CHINESE_REGEX = /[一-鿿]/;
const NOISE_CHARS_REGEX = /[\s.,\-_|~`'"!?()[\]{}:;·•。、，]/g;

export interface OcrStageDependencies {
  createEngine: () => OcrEngine;
  extractFrames: typeof extractFrames;
}

const DEFAULT_DEPENDENCIES: OcrStageDependencies = {
  createEngine: () => new TesseractOcrEngine(),
  extractFrames,
};

interface FrameResult {
  safe: boolean;
  reason?: OcrBlockReason;
  sample?: string;
  confidence: number;
}

function classifyFrameText(rawText: string, confidence: number): FrameResult {
  const cleaned = rawText.replace(NOISE_CHARS_REGEX, "");
  if (cleaned.length < MIN_TEXT_LENGTH) {
    return { safe: true, confidence };
  }
  if (CHINESE_REGEX.test(cleaned)) {
    return { safe: false, reason: "CHINESE_TEXT_DETECTED", sample: cleaned.slice(0, 30), confidence };
  }
  return { safe: false, reason: "TEXT_DETECTED", sample: cleaned.slice(0, 30), confidence };
}

function mergeFrameResults(
  frames: FrameResult[],
  intervalSeconds: number,
  totalDuration: number
): OcrSegment[] {
  const segments: (OcrSegment & { _confSum: number; _confCount: number })[] = [];
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!;
    const start = i * intervalSeconds;
    const end = Math.min((i + 1) * intervalSeconds, totalDuration);
    if (start >= totalDuration) break;

    const last = segments[segments.length - 1];
    if (last && last.ocr_safe === frame.safe && last.reason === frame.reason) {
      last.end = end;
      last._confSum += frame.confidence;
      last._confCount += 1;
      last.confidence = Math.round((last._confSum / last._confCount) * 10) / 10;
    } else {
      segments.push({
        start,
        end,
        ocr_safe: frame.safe,
        reason: frame.reason,
        sample_text: frame.sample,
        confidence: Math.round(frame.confidence * 10) / 10,
        _confSum: frame.confidence,
        _confCount: 1,
      });
    }
  }
  return segments.map(({ _confSum, _confCount, ...segment }) => segment);
}

async function analyzeSource(
  job: Job,
  sourceId: string,
  videoPath: string,
  duration: number,
  engine: OcrEngine,
  extractFramesDependency: typeof extractFrames
): Promise<OcrSegment[]> {
  const framesDir = jobFramesDir(job.job_id, sourceId);
  await fs.mkdir(framesDir, { recursive: true });

  let framePaths: string[];
  try {
    framePaths = await extractFramesDependency(videoPath, framesDir, SAMPLE_INTERVAL_SECONDS);
  } catch (err) {
    throw new PipelineError(
      "OCR",
      "OCR_ENGINE_FAILED",
      `${sourceId}에서 프레임을 추출하지 못했습니다: ${(err as Error).message}`,
      { source_id: sourceId }
    );
  }

  const frameResults: FrameResult[] = [];
  for (const framePath of framePaths) {
    try {
      const { rawText, confidence } = await engine.recognize(framePath);
      frameResults.push(classifyFrameText(rawText, confidence));
    } catch (err) {
      throw new PipelineError(
        "OCR",
        "OCR_ENGINE_FAILED",
        `${sourceId}의 OCR 분석 중 오류가 발생했습니다: ${(err as Error).message}`,
        { source_id: sourceId, context: { frame: framePath } }
      );
    }
  }

  return mergeFrameResults(frameResults, SAMPLE_INTERVAL_SECONDS, duration);
}

export type OcrProgressCallback = (job: Job) => void;

export async function runOcrStage(
  job: Job,
  onProgress?: OcrProgressCallback,
  dependencyOverrides: Partial<OcrStageDependencies> = {}
): Promise<void> {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  resetDownstreamStages(job, "OCR");
  startStage(job, "OCR");
  onProgress?.(job);

  if (!job.sources.length) {
    const error = {
      stage: "OCR" as const,
      error_code: "OCR_NO_SOURCES" as const,
      message: "분석할 영상이 없습니다. 먼저 영상을 업로드해주세요.",
      timestamp: new Date().toISOString(),
    };
    failStage(job, "OCR", error);
    throw new PipelineError("OCR", "OCR_NO_SOURCES", error.message);
  }

  const engine = dependencies.createEngine();
  try {
    for (const source of job.sources) {
      source.status = "ANALYZING";
      addLog(job, "OCR", "info", `${source.source_id} OCR 분석 시작`, { source_id: source.source_id });

      onProgress?.(job);
      const segments = await analyzeSource(
        job,
        source.source_id,
        source.file,
        source.duration,
        engine,
        dependencies.extractFrames
      );
      job.ocr[source.source_id] = segments;
      source.status = "ANALYZED";

      const blockedCount = segments.filter((s) => !s.ocr_safe).length;
      addLog(
        job,
        "OCR",
        "info",
        `${source.source_id} OCR 분석 완료 (${segments.length}개 구간, ${blockedCount}개 위험 구간)`,
        { source_id: source.source_id, segments: segments.length, blocked: blockedCount }
      );
      onProgress?.(job);
    }
    succeedStage(job, "OCR");
  } catch (err) {
    const pipelineErr =
      err instanceof PipelineError
        ? err
        : new PipelineError("OCR", "OCR_ENGINE_FAILED", (err as Error).message);
    const failedSource = job.sources.find((s) => s.source_id === pipelineErr.source_id);
    if (failedSource) failedSource.status = "FAILED";
    failStage(job, "OCR", {
      stage: "OCR",
      error_code: pipelineErr.code,
      message: pipelineErr.message,
      source_id: pipelineErr.source_id,
      context: pipelineErr.context,
      timestamp: new Date().toISOString(),
    });
    throw pipelineErr;
  } finally {
    await engine.dispose();
  }
}
