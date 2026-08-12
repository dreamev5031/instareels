import {
  AllocationCandidateBreakdown,
  AllocationDecision,
  Clip,
  Job,
  OcrSegment,
  PipelineError,
  Scene,
} from "@/shared/types";
import { addLog, failStage, resetDownstreamStages, startStage, succeedStage } from "@/jobs/store";
import { assertTtsReady } from "@/jobs/preconditions";

const FINISH_EPSILON = 0.001;
const MIN_CLIP_DURATION = 0.4;

function computeCandidateBreakdown(
  job: Job,
  usedClipIds: Set<string>,
  lastSourceId: string | null
): AllocationCandidateBreakdown {
  const allSegments: OcrSegment[] = Object.values(job.ocr).flat();
  const ocr_blocked = allSegments.filter((s) => !s.ocr_safe).length;
  const too_short = allSegments.filter(
    (s) => s.ocr_safe && s.end - s.start < MIN_CLIP_DURATION
  ).length;
  const already_used = job.clips.filter((c) => usedClipIds.has(c.clip_id)).length;
  const unused = job.clips.filter((c) => !usedClipIds.has(c.clip_id));
  const hasAlternativeSource =
    lastSourceId !== null && unused.some((c) => c.source_id !== lastSourceId);
  const same_source_policy = hasAlternativeSource
    ? unused.filter((c) => c.source_id === lastSourceId).length
    : 0;

  return {
    total_clips_on_sources: job.clips.length + ocr_blocked + too_short,
    ocr_blocked,
    too_short,
    already_used,
    same_source_policy,
    available: unused.length - same_source_policy,
  };
}

export function runAllocateStage(job: Job): void {
  assertTtsReady(job, "ALLOCATE");
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

    const totalUsableDuration = job.clips.reduce((sum, clip) => sum + clip.duration, 0);
    if (totalUsableDuration + FINISH_EPSILON < ttsDuration) {
      const breakdown = computeCandidateBreakdown(job, new Set<string>(), null);
      throw new PipelineError(
        "ALLOCATE",
        "INSUFFICIENT_TOTAL_DURATION",
        `OCR SAFE 영상 길이(${totalUsableDuration.toFixed(2)}초)가 TTS 길이(${ttsDuration.toFixed(2)}초)보다 부족합니다.`,
        {
          scene_id: "SCENE_001",
          context: {
            required_duration: ttsDuration,
            usable_duration: Math.round(totalUsableDuration * 1000) / 1000,
            shortage: Math.round((ttsDuration - totalUsableDuration) * 1000) / 1000,
            breakdown,
          },
        }
      );
    }

    const safeSourceCount = new Set(job.clips.map((clip) => clip.source_id)).size;
    const targetDistinctSources = Math.min(
      safeSourceCount,
      Math.max(1, Math.floor(ttsDuration / MIN_CLIP_DURATION))
    );
    const balancedSceneCap = ttsDuration / targetDistinctSources;

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
    const decisions: AllocationDecision[] = [];
    job.allocation_decisions = decisions;

    while (ttsDuration - timelineCursor > FINISH_EPSILON) {
      const remaining = ttsDuration - timelineCursor;
      const candidates = job.clips.filter((c) => !usedClipIds.has(c.clip_id));

      if (candidates.length === 0) {
        job.scenes = scenes;
        const breakdown = computeCandidateBreakdown(job, usedClipIds, lastSourceId);
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
      const selectionPolicy: AllocationDecision["selection_policy"] =
        lastSourceId === null
          ? "FIRST_SCENE_BALANCE"
          : preferred.length > 0
            ? "AVOID_PREVIOUS_SOURCE"
            : "ONLY_AVAILABLE_SOURCE";

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
      const effDuration =
        Math.round(Math.min(picked.duration, remaining, balancedSceneCap) * 1000) / 1000;

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

      const sourceUsedBefore = sourceUsedDuration.get(picked.source_id) ?? 0;
      const sourceSceneCountBefore = sourceSceneCount.get(picked.source_id) ?? 0;
      usedClipIds.add(picked.clip_id);
      const sourceUsedAfter = sourceUsedBefore + effDuration;
      sourceUsedDuration.set(picked.source_id, sourceUsedAfter);
      sourceSceneCount.set(picked.source_id, sourceSceneCountBefore + 1);

      const decision: AllocationDecision = {
        scene_id: sceneId,
        selected_source_id: picked.source_id,
        selected_clip_id: picked.clip_id,
        selected_clip_duration: picked.duration,
        allocated_duration: effDuration,
        remaining_before: Math.round(remaining * 1000) / 1000,
        source_used_duration_before: Math.round(sourceUsedBefore * 1000) / 1000,
        source_used_duration_after: Math.round(sourceUsedAfter * 1000) / 1000,
        source_scene_count_before: sourceSceneCountBefore,
        previous_source_id: lastSourceId,
        candidate_count: candidates.length,
        eligible_candidate_count: eligiblePool.length,
        selection_policy: selectionPolicy,
      };
      decisions.push(decision);
      addLog(job, "ALLOCATE", "info", `${sceneId}: ${picked.clip_id} 선택`, { ...decision });

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
