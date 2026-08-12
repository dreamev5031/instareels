import { Job } from "@/shared/types";

export default function DebugPanel({ job }: { job: Job }) {
  return (
    <details className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm shadow-sm">
      <summary className="cursor-pointer select-none font-semibold text-[var(--text-muted)]">
        디버그 정보 보기
      </summary>

      <div className="mt-3 flex flex-col gap-3">
        <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-xs">
          <span className="font-semibold">중국어 검사: </span>
          <span>{job.ocr_enabled ? "사용" : "사용 안 함"}</span>
          {job.stages.OCR.status === "SKIPPED" && (
            <p className="mt-1 text-[var(--text-muted)]">사용자 설정으로 검사를 건너뜀 · DISABLED_BY_USER</p>
          )}
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold text-[var(--text-muted)]">단계별 상태</p>
          <ul className="flex flex-col gap-1 font-mono text-xs">
            {Object.entries(job.stages).map(([stage, state]) => (
              <li key={stage} className="flex justify-between rounded bg-gray-50 px-2 py-1">
                <span>{stage}</span>
                <span>{state.status}{state.skipReason ? ` · ${state.skipReason}` : ""}</span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="mb-1 text-xs font-semibold text-[var(--text-muted)]">로그 ({job.logs.length})</p>
          <div className="max-h-56 overflow-y-auto rounded bg-gray-50 p-2">
            {job.logs.map((log, i) => (
              <p key={i} className="font-mono text-[11px] leading-relaxed">
                <span className="text-[var(--text-muted)]">[{log.stage}]</span>{" "}
                <span className={log.level === "error" ? "text-[var(--danger)]" : ""}>{log.message}</span>
              </p>
            ))}
          </div>
        </div>

        {Object.values(job.ocr).some((segments) => segments.some((segment) => !segment.ocr_safe)) && (
          <div>
            <p className="mb-1 text-xs font-semibold text-[var(--text-muted)]">OCR BLOCKED 구간</p>
            <ul className="flex flex-col gap-1">
              {Object.entries(job.ocr).flatMap(([sourceId, segments]) =>
                segments
                  .filter((s) => !s.ocr_safe)
                  .map((s, i) => {
                    const lowConfidence = (s.confidence ?? 0) < 50;
                    return (
                      <li
                        key={`${sourceId}-${i}`}
                        className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded bg-[var(--danger-bg)] px-2 py-1 text-[11px]"
                      >
                        <span className="font-mono font-semibold">{sourceId}</span>
                        <span className="tabular-nums text-[var(--text-muted)]">
                          {s.start.toFixed(1)}~{s.end.toFixed(1)}s
                        </span>
                        <span>{s.reason}</span>
                        <span
                          className={lowConfidence ? "font-semibold text-[var(--warning)]" : "text-[var(--text-muted)]"}
                          title={lowConfidence ? "신뢰도가 낮아 오탐일 수 있습니다" : undefined}
                        >
                          confidence {s.confidence?.toFixed(0) ?? "?"}
                          {lowConfidence ? " (오탐 의심)" : ""}
                        </span>
                        {s.sample_text && <span className="text-[var(--text-muted)]">&quot;{s.sample_text}&quot;</span>}
                      </li>
                    );
                  })
              )}
            </ul>
          </div>
        )}

        {job.allocation_decisions && job.allocation_decisions.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold text-[var(--text-muted)]">배정 선택 근거</p>
            <ul className="flex flex-col gap-1.5">
              {job.allocation_decisions.map((decision) => (
                <li key={decision.scene_id} className="min-w-0 rounded bg-gray-50 px-2 py-1.5 text-[11px]">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="shrink-0 font-mono font-semibold">{decision.scene_id}</span>
                    <span className="truncate font-mono text-[var(--primary)]">
                      {decision.selected_clip_id}
                    </span>
                    <span className="ml-auto shrink-0 tabular-nums text-[var(--text-muted)]">
                      {decision.allocated_duration.toFixed(2)}초
                    </span>
                  </div>
                  <p className="mt-0.5 break-words text-[var(--text-muted)]">
                    이전 {decision.previous_source_id ?? "없음"} · 후보 {decision.candidate_count}개 ·
                    선택 가능 {decision.eligible_candidate_count}개 · 누적 {decision.source_used_duration_after.toFixed(2)}초
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {job.validation && (
          <div>
            <p className="mb-1 text-xs font-semibold text-[var(--text-muted)]">검증 항목</p>
            <ul className="flex flex-col gap-1">
              {job.validation.checks.map((c) => (
                <li key={c.code} className="flex items-start gap-1.5 text-xs">
                  <span className={c.passed ? "text-[var(--success)]" : "text-[var(--danger)]"}>
                    {c.skipped ? "−" : c.passed ? "✓" : "✕"}
                  </span>
                  <span>{c.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <details>
          <summary className="cursor-pointer select-none text-xs text-[var(--text-muted)]">원본 JOB JSON</summary>
          <pre className="mt-2 max-h-72 overflow-auto rounded bg-gray-900 p-2 text-[10px] text-gray-100">
            {JSON.stringify(job, null, 2)}
          </pre>
        </details>
      </div>
    </details>
  );
}
