import { Clip, Job, PipelineError } from "@/shared/types";
import { addLog, failStage, resetDownstreamStages, startStage, succeedStage } from "@/jobs/store";
import { assertTtsReady } from "@/jobs/preconditions";

const MIN_CLIP_DURATION = 0.4;
const MAX_CLIP_DURATION = 2.2;

function splitSafeSegment(start: number, end: number): { start: number; end: number }[] {
  const total = end - start;
  if (total < MIN_CLIP_DURATION) return [];
  if (total <= MAX_CLIP_DURATION) return [{ start, end }];

  const pieceCount = Math.ceil(total / MAX_CLIP_DURATION);
  const pieceLen = total / pieceCount;
  const pieces: { start: number; end: number }[] = [];
  for (let i = 0; i < pieceCount; i++) {
    const pStart = start + i * pieceLen;
    const pEnd = i === pieceCount - 1 ? end : start + (i + 1) * pieceLen;
    if (pEnd - pStart >= MIN_CLIP_DURATION) {
      pieces.push({ start: pStart, end: pEnd });
    }
  }
  return pieces;
}

export function runClipStage(job: Job): void {
  assertTtsReady(job, "CLIP");
  resetDownstreamStages(job, "CLIP");
  startStage(job, "CLIP");

  try {
    const clips: Clip[] = [];

    for (const source of job.sources) {
      const segments = job.ocr[source.source_id] ?? [];
      const safeSegments = segments.filter((s) => s.ocr_safe);
      let clipIndex = 0;

      for (const segment of safeSegments) {
        const pieces = splitSafeSegment(segment.start, segment.end);
        for (const piece of pieces) {
          clipIndex += 1;
          const clipId = `${source.source_id}_CLIP_${String(clipIndex).padStart(3, "0")}`;
          clips.push({
            clip_id: clipId,
            source_id: source.source_id,
            source_start: Math.round(piece.start * 1000) / 1000,
            source_end: Math.round(piece.end * 1000) / 1000,
            duration: Math.round((piece.end - piece.start) * 1000) / 1000,
            ocr_safe: true,
            used: false,
          });
        }
      }

      addLog(job, "CLIP", "info", `${source.source_id}에서 ${clipIndex}개 클립 생성`, {
        source_id: source.source_id,
        clip_count: clipIndex,
      });
    }

    if (clips.length === 0) {
      throw new PipelineError(
        "CLIP",
        "NO_SAFE_SEGMENTS",
        "OCR SAFE 구간이 없어 사용할 수 있는 영상 클립을 만들 수 없습니다.",
        { context: { source_count: job.sources.length } }
      );
    }

    job.clips = clips;
    succeedStage(job, "CLIP");
  } catch (err) {
    const pipelineErr =
      err instanceof PipelineError
        ? err
        : new PipelineError("CLIP", "CLIP_GENERATION_FAILED", (err as Error).message);
    failStage(job, "CLIP", {
      stage: "CLIP",
      error_code: pipelineErr.code,
      message: pipelineErr.message,
      context: pipelineErr.context,
      timestamp: new Date().toISOString(),
    });
    throw pipelineErr;
  }
}
