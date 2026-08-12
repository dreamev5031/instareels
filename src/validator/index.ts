import { Job, PipelineError, ValidationCheck, ValidationResult } from "@/shared/types";
import { addLog, failStage, resetDownstreamStages, startStage, succeedStage } from "@/jobs/store";

const DURATION_TOLERANCE_RATIO = 0.05;
const DURATION_TOLERANCE_MIN = 0.5;
const SOURCE_OVERUSE_RATIO = 0.6;
const MAX_CONSECUTIVE_SAME_SOURCE = 2;
const TIMELINE_GAP_EPSILON = 0.05;

export function runValidateStage(job: Job): void {
  resetDownstreamStages(job, "VALIDATE");
  startStage(job, "VALIDATE");

  try {
    const ttsDuration = job.tts?.duration ?? 0;
    const scenes = job.scenes;
    const totalSceneDuration = scenes.reduce((sum, s) => sum + s.duration, 0);
    const checks: ValidationCheck[] = [];

    // 1. total duration vs TTS duration
    const tolerance = Math.max(DURATION_TOLERANCE_MIN, ttsDuration * DURATION_TOLERANCE_RATIO);
    const durationDiff = Math.abs(totalSceneDuration - ttsDuration);
    checks.push({
      code: "DURATION_MISMATCH",
      passed: durationDiff <= tolerance,
      message:
        durationDiff <= tolerance
          ? `배정 영상 길이(${totalSceneDuration.toFixed(2)}초)가 TTS 길이(${ttsDuration.toFixed(2)}초)와 일치합니다.`
          : `배정 영상 길이(${totalSceneDuration.toFixed(2)}초)가 TTS 길이(${ttsDuration.toFixed(2)}초)와 ${durationDiff.toFixed(2)}초 차이납니다.`,
      detail: { totalSceneDuration, ttsDuration, tolerance },
    });

    // 2. duplicate clip_id
    const clipCounts = new Map<string, number>();
    for (const s of scenes) clipCounts.set(s.clip_id, (clipCounts.get(s.clip_id) ?? 0) + 1);
    const duplicateClips = [...clipCounts.entries()].filter(([, count]) => count > 1);
    checks.push({
      code: "DUPLICATE_CLIP",
      passed: duplicateClips.length === 0,
      message:
        duplicateClips.length === 0
          ? "동일 CLIP이 중복 사용되지 않았습니다."
          : `${duplicateClips.length}개의 CLIP이 중복 사용되었습니다: ${duplicateClips.map(([id]) => id).join(", ")}`,
      detail: { duplicateClips },
    });

    // 3. duplicate/overlapping source range
    const rangeOverlaps: string[] = [];
    const bySource = new Map<string, typeof scenes>();
    for (const s of scenes) {
      const list = bySource.get(s.source_id) ?? [];
      list.push(s);
      bySource.set(s.source_id, list);
    }
    for (const [, list] of bySource) {
      const sorted = [...list].sort((a, b) => a.source_start - b.source_start);
      for (let i = 0; i < sorted.length - 1; i++) {
        const current = sorted[i]!;
        const next = sorted[i + 1]!;
        if (current.source_end > next.source_start + 0.001) {
          rangeOverlaps.push(`${current.scene_id} <-> ${next.scene_id}`);
        }
      }
    }
    checks.push({
      code: "DUPLICATE_RANGE",
      passed: rangeOverlaps.length === 0,
      message:
        rangeOverlaps.length === 0
          ? "동일 원본 구간이 중복 사용되지 않았습니다."
          : `동일 원본 구간이 중복 사용되었습니다: ${rangeOverlaps.join(", ")}`,
      detail: { rangeOverlaps },
    });

    // 4. OCR blocked usage
    const blockedUsages: string[] = [];
    for (const s of scenes) {
      const segments = job.ocr[s.source_id] ?? [];
      const blocked = segments.filter((seg) => !seg.ocr_safe);
      for (const seg of blocked) {
        const overlaps = s.source_start < seg.end && s.source_end > seg.start;
        if (overlaps) blockedUsages.push(s.scene_id);
      }
    }
    checks.push({
      code: "OCR_BLOCKED_USED",
      passed: blockedUsages.length === 0,
      message:
        blockedUsages.length === 0
          ? "OCR BLOCKED 구간이 사용되지 않았습니다."
          : `OCR BLOCKED 구간을 사용한 SCENE이 있습니다: ${blockedUsages.join(", ")}`,
      detail: { blockedUsages },
    });

    // 5. consecutive same-source usage
    let maxRun = 0;
    let currentRun = 0;
    let lastSource: string | null = null;
    for (const s of scenes) {
      if (s.source_id === lastSource) currentRun += 1;
      else currentRun = 1;
      maxRun = Math.max(maxRun, currentRun);
      lastSource = s.source_id;
    }
    // consecutive-source repetition is structurally unavoidable when only one
    // source was ever uploaded, so the check only applies once alternatives exist
    const consecutiveApplicable = job.sources.length >= 2;
    checks.push({
      code: "CONSECUTIVE_SOURCE_LIMIT",
      passed: !consecutiveApplicable || maxRun <= MAX_CONSECUTIVE_SAME_SOURCE,
      message:
        !consecutiveApplicable || maxRun <= MAX_CONSECUTIVE_SAME_SOURCE
          ? "같은 SOURCE가 과도하게 연속 사용되지 않았습니다."
          : `같은 SOURCE가 ${maxRun}회 연속 사용되었습니다.`,
      detail: { maxRun },
    });

    // 6. source usage ratio (overuse)
    const sourceUsage: Record<string, { total_duration: number; ratio: number; scene_count: number }> = {};
    for (const [sourceId, list] of bySource) {
      const total = list.reduce((sum, s) => sum + s.duration, 0);
      sourceUsage[sourceId] = {
        total_duration: Math.round(total * 1000) / 1000,
        ratio: totalSceneDuration > 0 ? total / totalSceneDuration : 0,
        scene_count: list.length,
      };
    }
    const distinctSourcesUsed = Object.keys(sourceUsage).length;
    const overusedSources = Object.entries(sourceUsage).filter(
      ([, u]) => u.ratio > SOURCE_OVERUSE_RATIO
    );
    const overuseApplicable = job.sources.length >= 2;
    checks.push({
      code: "SOURCE_OVERUSE",
      passed: !overuseApplicable || overusedSources.length === 0,
      message:
        !overuseApplicable || overusedSources.length === 0
          ? "특정 SOURCE에 사용 시간이 몰리지 않았습니다."
          : overusedSources
              .map(([id, u]) => `${id} 사용률 ${(u.ratio * 100).toFixed(0)}% (허용 기준 ${SOURCE_OVERUSE_RATIO * 100}% 초과)`)
              .join(", "),
      detail: { sourceUsage, threshold: SOURCE_OVERUSE_RATIO },
    });

    // 7. empty timeline gaps
    const gaps: string[] = [];
    const sortedScenes = [...scenes].sort((a, b) => a.timeline_start - b.timeline_start);
    for (let i = 0; i < sortedScenes.length - 1; i++) {
      const current = sortedScenes[i]!;
      const next = sortedScenes[i + 1]!;
      const gap = next.timeline_start - current.timeline_end;
      if (gap > TIMELINE_GAP_EPSILON) {
        gaps.push(`${current.scene_id} -> ${next.scene_id} (${gap.toFixed(2)}초)`);
      }
    }
    checks.push({
      code: "EMPTY_TIMELINE_GAP",
      passed: gaps.length === 0,
      message: gaps.length === 0 ? "타임라인에 빈 구간이 없습니다." : `타임라인에 빈 구간이 있습니다: ${gaps.join(", ")}`,
      detail: { gaps },
    });

    const status: "PASS" | "FAIL" = checks.every((c) => c.passed) ? "PASS" : "FAIL";

    const result: ValidationResult = {
      status,
      checks,
      source_usage: sourceUsage,
      total_scene_duration: Math.round(totalSceneDuration * 1000) / 1000,
      tts_duration: ttsDuration,
      scene_count: scenes.length,
      source_count_used: distinctSourcesUsed,
      source_count_total: job.sources.length,
    };
    job.validation = result;

    if (status === "FAIL") {
      const failedChecks = checks.filter((c) => !c.passed);
      throw new PipelineError(
        "VALIDATE",
        failedChecks[0]!.code,
        `검증 실패: ${failedChecks.map((c) => c.code).join(", ")}`,
        { context: { failedChecks: failedChecks.map((c) => ({ code: c.code, message: c.message })) } }
      );
    }

    addLog(job, "VALIDATE", "info", "검증 통과", { scene_count: scenes.length });
    succeedStage(job, "VALIDATE");
  } catch (err) {
    const pipelineErr =
      err instanceof PipelineError
        ? err
        : new PipelineError("VALIDATE", "DURATION_MISMATCH", (err as Error).message);
    failStage(job, "VALIDATE", {
      stage: "VALIDATE",
      error_code: pipelineErr.code,
      message: pipelineErr.message,
      context: pipelineErr.context,
      timestamp: new Date().toISOString(),
    });
    throw pipelineErr;
  }
}
