"use client";

import { useRef } from "react";
import { Job } from "@/shared/types";
import { API_BASE_URL } from "@/ui/api";

interface Props {
  job: Job;
  loading: boolean;
  onUpload: (files: File[]) => void;
  onAnalyze: () => void;
  showAnalyzeButton: boolean;
  analyzing: boolean;
}

export default function UploadStep({ job, loading, onUpload, onAnalyze, showAnalyzeButton, analyzing }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handlePick() {
    inputRef.current?.click();
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) onUpload(files);
    e.target.value = "";
  }

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--primary)] text-xs font-semibold text-white">
          3
        </span>
        <h2 className="text-base font-semibold">영상 추가</h2>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        multiple
        className="hidden"
        onChange={handleChange}
      />

      <button
        className="w-full rounded-xl border border-dashed border-[var(--primary)]/50 bg-[var(--primary)]/5 py-3 text-sm font-semibold text-[var(--primary)] transition active:scale-[0.98] disabled:opacity-50"
        onClick={handlePick}
        disabled={loading}
      >
        {loading ? "업로드 중..." : "+ 영상 선택"}
      </button>

      {job.sources.length > 0 && (
        <div className="mt-3 flex gap-2.5 overflow-x-auto pb-1">
          {job.sources.map((s) => (
            <div
              key={s.source_id}
              className="w-28 shrink-0 overflow-hidden rounded-xl border border-[var(--border)] bg-white"
            >
              <div className="h-16 w-full bg-gray-100">
                <img
                  src={`${API_BASE_URL}/api/media/${job.job_id}/thumb/${s.source_id}`}
                  alt={s.source_id}
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="px-2 py-1.5">
                <p className="truncate text-[11px] font-semibold">{s.source_id}</p>
                <p className="text-[11px] text-[var(--text-muted)]">{s.duration.toFixed(1)}초</p>
                <p className="text-[11px] text-[var(--success)]">✓ 업로드</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAnalyzeButton && (
        <button
          className="mt-3 w-full rounded-xl bg-[var(--primary-dark)] py-3 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-50"
          onClick={onAnalyze}
          disabled={analyzing}
        >
          영상 분석 시작
        </button>
      )}
    </section>
  );
}
