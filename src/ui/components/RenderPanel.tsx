"use client";

import type { Job, RenderSubstageName } from "@/shared/types";
import { API_BASE_URL } from "@/ui/api";

const SUBSTAGE_LABELS: Record<RenderSubstageName, string> = {
  VIDEO_ASSEMBLY: "본영상 조립",
  SUBTITLE_GENERATION: "ASS 자막 생성",
  SUBTITLE_BURN: "자막 입히기",
  COVER_RENDER: "앞표지 생성",
  FINAL_CONCAT: "최종 영상 결합",
  OUTPUT_VALIDATE: "출력 검증",
};

export default function RenderPanel({
  job,
  rendering,
  onRender,
  subtitleReady,
}: {
  job: Job;
  rendering: boolean;
  onRender: () => void;
  subtitleReady: boolean;
}) {
  const stage = job.stages.RENDER;
  const result = job.render;
  const success = stage.status === "SUCCESS" && result?.status === "SUCCESS";
  const failed = stage.status === "FAILED";

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm" data-testid="render-panel">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold">최종 영상 렌더</h3>
          <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">검증된 장면과 TTS, 앞표지 0.1초를 합칩니다.</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${
          success ? "bg-[var(--success-bg)] text-[var(--success)]" : failed ? "bg-[var(--danger-bg)] text-[var(--danger)]" : "bg-slate-100 text-[var(--text-muted)]"
        }`}>
          {success ? "완료" : failed ? "실패" : rendering ? "진행 중" : "대기"}
        </span>
      </div>

      {result && (
        <ul className="mt-3 grid grid-cols-2 gap-1.5 text-[11px]">
          {Object.entries(result.substages).map(([name, state]) => (
            <li key={name} className="flex min-w-0 items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-2">
              <span className="truncate">{SUBSTAGE_LABELS[name as RenderSubstageName]}</span>
              <span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)]">{state.status}</span>
            </li>
          ))}
        </ul>
      )}

      {failed && (
        <p className="mt-3 rounded-xl bg-[var(--danger-bg)] px-3 py-2 text-xs text-[var(--danger)]">
          {String(stage.error?.context?.substage ?? "RENDER")}: {stage.error?.message ?? "렌더에 실패했습니다."}
        </p>
      )}

      {success ? (
        <div className="mt-3">
          <video
            data-testid="rendered-video"
            src={`${API_BASE_URL}${result.final_media_path}`}
            controls
            playsInline
            preload="metadata"
            className="aspect-[9/16] max-h-[520px] w-full rounded-xl bg-black object-contain"
          />
          <p className="mt-2 text-center text-xs text-[var(--text-muted)]">
            {result.width}×{result.height} · {result.video_codec?.toUpperCase()} / {result.audio_codec?.toUpperCase()} · {result.final_duration?.toFixed(2)}초
          </p>
        </div>
      ) : (
        <button
          type="button"
          data-testid="render-button"
          onClick={onRender}
          disabled={rendering || job.validation?.status !== "PASS" || !subtitleReady}
          className="mt-3 w-full rounded-xl bg-[var(--primary-dark)] py-3 text-sm font-semibold text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {rendering ? "영상 렌더 중..." : failed ? "영상 렌더 다시 시도" : "영상 렌더"}
        </button>
      )}
      {!success && !subtitleReady && <p className="mt-2 text-center text-[11px] text-[var(--warning)]">자막 설정을 저장하면 렌더할 수 있습니다.</p>}
    </section>
  );
}
