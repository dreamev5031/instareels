import type { Job, StageName } from "@/shared/types";

const STEPS = ["TTS", "앞표지", "영상", "분석", "자막", "결과"];

export default function WorkflowSteps({ job }: { job: Job | null }) {
  const completed = [
    job?.stages.TTS.status === "SUCCESS",
    job?.stages.COVER.status === "SUCCESS",
    job?.stages.UPLOAD.status === "SUCCESS",
    Boolean(job && (["OCR", "CLIP", "ALLOCATE"] as StageName[]).some((stage) => job.stages[stage].status === "SUCCESS")),
    job?.subtitle.status === "SUCCESS",
    job?.stages.VALIDATE.status === "SUCCESS",
  ];
  const firstIncomplete = completed.findIndex((done) => !done);
  const activeIndex = firstIncomplete === -1 ? STEPS.length - 1 : firstIncomplete;

  return (
    <ol className="mt-3 grid grid-cols-6 gap-1" aria-label="작업 단계">
      {STEPS.map((label, index) => {
        const done = completed[index];
        const active = index === activeIndex;
        return (
          <li key={label} className="min-w-0 text-center">
            <span className={`mx-auto flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${done ? "bg-[var(--success)] text-white" : active ? "bg-[var(--primary)] text-white" : "bg-slate-200 text-slate-500"}`}>
              {done ? "✓" : index + 1}
            </span>
            <span className={`mt-1 block truncate text-[10px] ${active ? "font-bold text-[var(--primary)]" : "text-[var(--text-muted)]"}`}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
