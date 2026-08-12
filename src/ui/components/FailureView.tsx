"use client";

import { AllocationCandidateBreakdown, Job, StageName } from "@/shared/types";

const STAGE_TITLES: Record<StageName, string> = {
  TTS: "TTS 생성 실패",
  UPLOAD: "영상 업로드 실패",
  OCR: "OCR 분석 실패",
  CLIP: "영상 구간 생성 실패",
  ALLOCATE: "영상 배정 실패",
  VALIDATE: "배정 검증 실패",
};

interface Props {
  job: Job;
  stage: StageName;
  onRetry: () => void;
  retrying: boolean;
}

export default function FailureView({ job, stage, onRetry, retrying }: Props) {
  const error = job.stages[stage].error;
  if (!error) return null;

  const breakdown = error.context?.breakdown as AllocationCandidateBreakdown | undefined;
  const failedChecks = error.context?.failedChecks as { code: string; message: string }[] | undefined;

  return (
    <section className="rounded-2xl border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-4 shadow-sm">
      <h2 className="text-base font-bold text-[var(--danger)]">{STAGE_TITLES[stage]}</h2>
      <p className="mt-1 text-xs text-[var(--text-muted)]">{stage} 단계에서 문제가 발생했습니다.</p>

      <p className="mt-3 text-sm font-medium leading-relaxed">{error.message}</p>

      {breakdown && (
        <div className="mt-3 rounded-xl bg-white/70 p-3 text-xs leading-relaxed">
          <p className="font-semibold">후보 {breakdown.total_clips_on_sources}개</p>
          <ul className="mt-1 list-disc pl-4 text-[var(--text-muted)]">
            <li>{breakdown.ocr_blocked}개 OCR 제외</li>
            <li>{breakdown.already_used}개 이미 사용</li>
            <li>{breakdown.same_source_policy}개 연속 SOURCE 정책 제외</li>
            <li>{breakdown.too_short}개 길이 부족</li>
            <li>{breakdown.available}개 사용 가능</li>
          </ul>
        </div>
      )}

      {failedChecks && failedChecks.length > 0 && (
        <div className="mt-3 rounded-xl bg-white/70 p-3 text-xs leading-relaxed">
          <p className="font-semibold">검증 실패 항목 {failedChecks.length}개</p>
          <ul className="mt-1 list-disc pl-4 text-[var(--text-muted)]">
            {failedChecks.map((c) => (
              <li key={c.code}>{c.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
        {error.source_id && (
          <span className="rounded-full bg-white px-2 py-1 font-mono text-[var(--text-muted)]">{error.source_id}</span>
        )}
        {error.clip_id && (
          <span className="rounded-full bg-white px-2 py-1 font-mono text-[var(--text-muted)]">{error.clip_id}</span>
        )}
        {error.scene_id && (
          <span className="rounded-full bg-white px-2 py-1 font-mono text-[var(--text-muted)]">{error.scene_id}</span>
        )}
        <span className="rounded-full bg-white px-2 py-1 font-mono text-[var(--text-muted)]">{error.error_code}</span>
      </div>

      <button
        className="mt-4 w-full rounded-xl bg-[var(--danger)] py-3 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-50"
        onClick={onRetry}
        disabled={retrying}
      >
        {retrying ? "다시 시도 중..." : "다시 시도"}
      </button>
    </section>
  );
}
