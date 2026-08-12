import { Scene } from "@/shared/types";

export default function SceneList({ scenes }: { scenes: Scene[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {scenes.map((scene) => (
        <li
          key={scene.scene_id}
          className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-sm"
        >
          <div>
            <p className="font-semibold">{scene.scene_id.replace("_", " ")}</p>
            <p className="text-xs text-[var(--text-muted)] tabular-nums">
              {scene.timeline_start.toFixed(2)} ~ {scene.timeline_end.toFixed(2)}초
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-xs text-[var(--primary)]">{scene.source_id}</p>
            <p className="font-mono text-[11px] text-[var(--text-muted)]">
              {scene.clip_id.split("_").slice(-2).join("_")}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
