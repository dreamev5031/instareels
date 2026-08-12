import {
  AllocationCandidateBreakdown,
  Clip,
  Job,
  OcrSegment,
  PipelineError,
  Scene,
} from "@/shared/types";
import { addLog, failStage, resetDownstreamStages, startStage, succeedStage } from "@/jobs/store";

const FINISH_EPSILON = 0.2;
const MIN_CLIP_DURATION = 0.4;

function computeCandidateBreakdown(
  job: Job,
  usedClipIds: Set<string>,
  availableCount: number
): AllocationCandidateBreakdown {
  const allSegments: OcrSegment[] = Object.values(job.ocr).flat();
  const ocr_blocked = allSegments.filter((s) => !s.ocr_safe).length;
  const too_short = allSegments.filter(
    (s) => s.ocr_safe && s.end - s.start < MIN_CLIP_DURATION
  ).length;
  const already_used = job.clips.filter((c) => usedClipIds.has(c.clip_id)).length;

  return {
    total_clips_on_sources: allSegments.length,
    ocr_blocked,
    too_short,
    already_used,
    available: availableCount,
  };
}

export function runAllocateStage(job: Job): void {
  resetDownstreamStages(job, "ALLOCATE");
  startStage(job, "ALLOCATE");

  const ttsDuration = job.tts?.duration ?? 0;

  try {
    if (ttsDuration <= 0) {
      throw new PipelineError(
        "ALLOCATE",
        "INSUFFICIENT_TOTAL_DURATION",
        "TTS 길이가 확인되지 않아 영상을 배정할 수 없습니다.",
        { context: { ttsDuration } }
      );
    }

    const pool: Clip[] = job.clips.map((c) => ({ ...c }));
    const usedClipIds = new Set<string>();
    const sourceUsedDuration = new Map<string, number>();
    const sourceSceneCount = new Map<string, number>();
    for (const source of job.sources) {
      sourceUsedDuration.set(source.source_id, 0);
      sourceSceneCount.set(source.source_id, 0);
    }

    let lastSourceId: string | null = null;
    let timelineCursor = 0;
    let sceneIndex = 0;
    const scenes: Scene[] = [];

    while (ttsDuration - timelineCursor > FINISH_EPSILON) {
      const remaining = ttsDuration - timelineCursor;
      const candidates = pool.filter((c) => !usedClipIds.has(c.clip_id));

      if (candidates.length === 0) {
        job.scenes = scenes;
        const breakdown = computeCandidateBreakdown(job, usedClipIds, 0);
        throw new PipelineError(
          "ALLOCATE",
          "NO_AVAILABLE_CLIP",
          `SCENE_${String(sceneIndex + 1).padStart(3, "0")}을 채울 사용 가능한 영상 구간이 없습니다.`,
          {
            scene_id: `SCENE_${String(sceneIndex + 1).padStart(3, "0")}`,
            context: { required_duration: Math.round(remaining * 100) / 100, breakdown },
          }
        );
      }

      const preferred = candidates.filter((c) => c.source_id !== lastSourceId);
      const eligiblePool = preferred.length > 0 ? preferred : candidates;

      // fitScore: clips that fit fully within `remaining` are preferred, smallest-first
      // (keeps scenes short so more distinct sources get rotated in rather than one
      // source's clip swallowing most of the remaining timeline); clips that require
      // trimming are ranked after, smallest-overshoot-first.
      const fitScore = (c: Clip) =>
        c.duration <= remaining ? c.duration : c.duration - remaining + 1e6;

      eligiblePool.sort((a, b) => {
        const usedA = sourceUsedDuration.get(a.source_id) ?? 0;
        const usedB = sourceUsedDuration.get(b.source_id) ?? 0;
        if (usedA !== usedB) return usedA - usedB;

        const scoreDiff = fitScore(a) - fitScore(b);
        if (scoreDiff !== 0) return scoreDiff;
        return a.clip_id.localeCompare(b.clip_id);
      });

      const picked = eligiblePool[0]!;
      const effDuration = Math.round(Math.min(picked.duration, remaining) * 1000) / 1000;

      sceneIndex += 1;
      const sceneId = `SCENE_${String(sceneIndex).padStart(3, "0")}`;
      const sourceStart = picked.source_start;
      const sourceEnd = Math.round((picked.source_start + effDuration) * 1000) / 1000;

      const scene: Scene = {
        scene_id: sceneId,
        timeline_start: Math.round(timelineCursor * 1000) / 1000,
        timeline_end: Math.round((timelineCursor + effDuration) * 1000) / 1000,
        duration: effDuration,
        source_id: picked.source_id,
        clip_id: picked.clip_id,
        source_start: sourceStart,
        source_end: sourceEnd,
      };
      scenes.push(scene);

      usedClipIds.add(picked.clip_id);
      sourceUsedDuration.set(picked.source_id, (sourceUsedDuration.get(picked.source_id) ?? 0) + effDuration);
      sourceSceneCount.set(picked.source_id, (sourceSceneCount.get(picked.source_id) ?? 0) + 1);
      lastSourceId = picked.source_id;
      timelineCursor += effDuration;
    }

    for (const clip of job.clips) {
      clip.used = usedClipIds.has(clip.clip_id);
    }
    job.scenes = scenes;

    addLog(
      job,
      "ALLOCATE",
      "info",
      `${scenes.length}개 SCENE 배정 완료 (총 ${timelineCursor.toFixed(2)}초 / TTS ${ttsDuration.toFixed(2)}초)`,
      {
        scene_count: scenes.length,
        total_duration: timelineCursor,
        source_usage: Object.fromEntries(sourceUsedDuration),
      }
    );
    succeedStage(job, "ALLOCATE");
  } catch (err) {
    const pipelineErr =
      err instanceof PipelineError
        ? err
        : new PipelineError("ALLOCATE", "NO_AVAILABLE_CLIP", (err as Error).message);
    failStage(job, "ALLOCATE", {
      stage: "ALLOCATE",
      error_code: pipelineErr.code,
      message: pipelineErr.message,
      scene_id: pipelineErr.scene_id,
      context: pipelineErr.context,
      timestamp: new Date().toISOString(),
    });
    throw pipelineErr;
  }
}
