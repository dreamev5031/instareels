import { Job } from "@/shared/types";
import SceneList from "./SceneList";
import DebugPanel from "./DebugPanel";

const SOURCE_BAR_COLORS = ["#4f46e5", "#0ea5e9", "#16a34a", "#d97706", "#dc2626", "#7c3aed"];

export default function ResultSummary({ job }: { job: Job }) {
  const v = job.validation;
  if (!v) return null;

  const sourceEntries = Object.entries(v.source_usage).sort((a, b) => b[1].ratio - a[1].ratio);

  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-2xl border border-[var(--success)]/30 bg-[var(--success-bg)] p-4 shadow-sm">
        <h2 className="text-base font-bold text-[var(--success)]">영상 구성 완료</h2>

        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-[var(--text-muted)]">TTS 길이</p>
            <p className="font-semibold tabular-nums">{v.tts_duration.toFixed(2)}초</p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-muted)]">배정 영상 길이</p>
            <p className="font-semibold tabular-nums">{v.total_scene_duration.toFixed(2)}초</p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-muted)]">총 장면</p>
            <p className="font-semibold tabular-nums">{v.scene_count}개</p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-muted)]">사용 원본</p>
            <p className="font-semibold tabular-nums">
              {v.source_count_used}개 / {v.source_count_total}개
            </p>
          </div>
        </div>

        <div className="mt-4">
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-gray-200">
            {sourceEntries.map(([id, u], i) => (
              <div
                key={id}
                style={{ width: `${u.ratio * 100}%`, background: SOURCE_BAR_COLORS[i % SOURCE_BAR_COLORS.length] }}
              />
            ))}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {sourceEntries.map(([id, u], i) => (
              <li key={id} className="flex items-center gap-1">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: SOURCE_BAR_COLORS[i % SOURCE_BAR_COLORS.length] }}
                />
                <span className="font-mono">{id}</span>
                <span className="text-[var(--text-muted)] tabular-nums">{(u.ratio * 100).toFixed(0)}%</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-[var(--text-muted)]">SCENE 목록</h3>
        <SceneList scenes={job.scenes} />
      </section>

      <DebugPanel job={job} />
    </div>
  );
}
