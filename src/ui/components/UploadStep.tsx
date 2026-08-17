"use client";

import { useRef, useState } from "react";
import { Job } from "@/shared/types";
import { API_BASE_URL } from "@/ui/api";

interface Props {
  job: Job | null;
  loading: boolean;
  onUpload: (files: File[]) => void;
  onDeleteSource: (sourceId: string) => Promise<void>;
  onAnalyze: () => void;
  canUpload: boolean;
  canAnalyze: boolean;
  analyzing: boolean;
  analysisComplete: boolean;
  ttsReady: boolean;
  coverReady: boolean;
  ocrEnabled: boolean;
  onOcrEnabledChange: (enabled: boolean) => void;
  ocrLocked: boolean;
}

export default function UploadStep({
  job,
  loading,
  onUpload,
  onDeleteSource,
  onAnalyze,
  canUpload,
  canAnalyze,
  analyzing,
  analysisComplete,
  ttsReady,
  coverReady,
  ocrEnabled,
  onOcrEnabledChange,
  ocrLocked,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [deletingSourceId, setDeletingSourceId] = useState<string | null>(null);
  const sources = job?.sources ?? [];
  const ocrStage = job?.stages.OCR;
  const blockedCount = Object.values(job?.ocr ?? {}).flat().filter((segment) => !segment.ocr_safe).length;

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) onUpload(files);
    event.target.value = "";
  }

  async function handleDelete(sourceId: string) {
    if (deletingSourceId || analyzing || loading) return;
    setDeletingSourceId(sourceId);
    try {
      await onDeleteSource(sourceId);
    } finally {
      setDeletingSourceId(null);
    }
  }

  const disabledReason = !ttsReady
    ? "먼저 TTS를 생성해 주세요."
    : !coverReady
      ? "앞표지를 완성하면 영상 분석을 시작할 수 있습니다."
      : sources.length === 0
        ? "영상을 업로드하면 분석을 시작할 수 있습니다."
        : null;

  const ocrMessage =
    ocrStage?.status === "RUNNING" && ocrEnabled
      ? "중국어 검사 중"
      : ocrStage?.status === "SKIPPED"
        ? "사용자 설정으로 검사를 건너뜀"
        : ocrStage?.status === "SUCCESS" && ocrEnabled
          ? `검사 완료 · BLOCKED ${blockedCount}개`
          : ocrEnabled
            ? "중국어/문자를 감지해 해당 구간을 제외합니다."
            : "검사를 건너뛰고 전체 영상을 그대로 사용합니다.";

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm" data-testid="video-analysis-step">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--primary)] text-xs font-semibold text-white">3</span>
        <div>
          <h2 className="text-base font-semibold">본영상 추가</h2>
          <p className="text-[11px] text-[var(--text-muted)]">TTS 길이에 맞춰 사용할 구간을 구성합니다.</p>
        </div>
      </div>

      <input
        ref={inputRef}
        data-testid="video-file-input"
        type="file"
        accept=".mp4,.mov,video/mp4,video/quicktime"
        multiple
        className="hidden"
        onChange={handleChange}
      />

      <button
        type="button"
        className="w-full rounded-xl border border-dashed border-[var(--primary)]/50 bg-[var(--primary)]/5 py-3 text-sm font-semibold text-[var(--primary)] transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        onClick={() => inputRef.current?.click()}
        disabled={loading || analyzing || !canUpload}
      >
        {loading ? "업로드 중..." : "+ 영상 선택"}
      </button>

      {sources.length > 0 && job && (
        <div className="mt-3 flex gap-2.5 overflow-x-auto pb-1" data-testid="video-thumbnails">
          {sources.map((source) => (
            <div key={source.source_id} className="relative w-28 shrink-0 overflow-hidden rounded-xl border border-[var(--border)] bg-white">
              <div className="h-16 w-full bg-gray-100">
                <img
                  src={`${API_BASE_URL}/api/media/${job.job_id}/thumb/${source.source_id}`}
                  alt={source.source_id}
                  className="h-full w-full object-cover"
                />
              </div>
              <button
                type="button"
                aria-label={`${source.source_id} 삭제`}
                data-testid={`delete-source-${source.source_id}`}
                disabled={Boolean(deletingSourceId) || analyzing || loading}
                onClick={() => void handleDelete(source.source_id)}
                className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-black/65 text-lg font-medium leading-none text-white shadow-sm backdrop-blur-sm transition active:scale-90 disabled:opacity-40"
              >
                {deletingSourceId === source.source_id ? "…" : "×"}
              </button>
              <div className="px-2 py-1.5">
                <p className="truncate text-[11px] font-semibold">{source.source_id}</p>
                <p className="text-[11px] text-[var(--text-muted)]">{source.duration.toFixed(1)}초</p>
                <p className="text-[11px] text-[var(--success)]">✓ 업로드</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {job?.video_sources_changed && (
        <p data-testid="video-changed-notice" className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-center text-xs font-medium text-amber-700">
          영상이 변경되어 다시 분석이 필요합니다.
        </p>
      )}

      <div className="mt-3 rounded-xl bg-slate-50 px-3 py-3" data-testid="ocr-setting">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">중국어 검사</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--text-muted)]">{ocrMessage}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={`text-[11px] font-bold ${ocrEnabled ? "text-[var(--primary)]" : "text-[var(--text-muted)]"}`}>
              {ocrEnabled ? "ON" : "OFF"}
            </span>
            <button
              type="button"
              role="switch"
              aria-label="중국어 검사"
              aria-checked={ocrEnabled}
              data-testid="ocr-toggle"
              onClick={() => onOcrEnabledChange(!ocrEnabled)}
              disabled={ocrLocked}
              className={`relative h-7 w-12 rounded-full transition disabled:opacity-50 ${ocrEnabled ? "bg-[var(--primary)]" : "bg-slate-300"}`}
            >
              <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition ${ocrEnabled ? "left-6" : "left-1"}`} />
            </button>
          </div>
        </div>
      </div>

      <button
        type="button"
        data-testid="analyze-button"
        className="mt-3 w-full rounded-xl bg-[var(--primary-dark)] py-3 text-sm font-semibold text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        onClick={onAnalyze}
        disabled={!canAnalyze || analyzing}
      >
        {analysisComplete ? "영상 분석 완료" : analyzing ? "영상 분석 중..." : "영상 분석 시작"}
      </button>

      {disabledReason && !analysisComplete && !analyzing && (
        <p data-testid="analysis-disabled-reason" className="mt-2 text-center text-xs font-medium text-[var(--warning)]">
          {disabledReason}
        </p>
      )}
    </section>
  );
}
