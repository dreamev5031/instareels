"use client";

import { Job, StageName } from "@/shared/types";

const STAGE_LABELS: Record<StageName, string> = {
  COVER: "앞표지 설정",
  TTS: "TTS 생성",
  UPLOAD: "영상 업로드",
  OCR: "OCR 분석",
  CLIP: "영상 구간 생성",
  ALLOCATE: "장면 배정",
  VALIDATE: "검증",
};

const VISIBLE_STAGES: StageName[] = ["TTS", "COVER", "UPLOAD", "OCR", "CLIP", "ALLOCATE", "VALIDATE"];

function StatusIcon({ status }: { status: string }) {
  if (status === "SUCCESS") return <span className="text-[var(--success)]">✓</span>;
  if (status === "FAILED") return <span className="text-[var(--danger)]">✕</span>;
  if (status === "RUNNING") return <span className="animate-pulse text-[var(--primary)]">●</span>;
  return <span className="text-[var(--pending)]">○</span>;
}

export default function ProgressView({ job }: { job: Job }) {
  const analyzedCount = job.sources.filter((s) => s.status === "ANALYZED").length;
  const totalSources = job.sources.length;
  const ocrRunning = job.stages.OCR.status === "RUNNING";

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-[var(--text-muted)]">영상 준비 중</h2>
      <ul className="flex flex-col gap-2">
        {VISIBLE_STAGES.map((stage) => {
          const state = job.stages[stage];
          return (
            <li key={stage} className="flex items-center gap-2.5 text-sm">
              <StatusIcon status={state.status} />
              <span className={state.status === "PENDING" ? "text-[var(--pending)]" : "text-[var(--text)]"}>
                {STAGE_LABELS[stage]}
              </span>
              {stage === "OCR" && ocrRunning && totalSources > 0 && (
                <span className="ml-auto text-xs text-[var(--text-muted)] tabular-nums">
                  {analyzedCount}/{totalSources}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
