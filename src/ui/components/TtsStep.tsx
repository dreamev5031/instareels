"use client";

import { Job } from "@/shared/types";
import { SUPPORTED_VOICES } from "@/tts/voices";

interface Props {
  text: string;
  onTextChange: (v: string) => void;
  voice: string;
  onVoiceChange: (v: string) => void;
  loading: boolean;
  job: Job | null;
  onGenerate: () => void;
}

export default function TtsStep({ text, onTextChange, voice, onVoiceChange, loading, job, onGenerate }: Props) {
  const ttsSuccess = job?.stages.TTS.status === "SUCCESS" && job.tts;

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--primary)] text-xs font-semibold text-white">
          1
        </span>
        <h2 className="text-base font-semibold">TTS 만들기</h2>
      </div>

      <textarea
        className="w-full resize-none rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-sm leading-relaxed outline-none focus:border-[var(--primary)]"
        rows={5}
        placeholder="영상에 사용할 나레이션을 입력하세요"
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        disabled={loading}
      />

      <div className="mt-3 flex items-center gap-2">
        <label className="shrink-0 text-xs font-medium text-[var(--text-muted)]">목소리</label>
        <select
          className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-white px-2.5 py-2 text-sm outline-none focus:border-[var(--primary)]"
          value={voice}
          onChange={(e) => onVoiceChange(e.target.value)}
          disabled={loading}
        >
          {SUPPORTED_VOICES.map((v) => (
            <option key={v.shortName} value={v.shortName}>
              {v.friendlyName}
            </option>
          ))}
        </select>
      </div>

      <button
        className="mt-3 w-full rounded-xl bg-[var(--primary)] py-3 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-50"
        onClick={onGenerate}
        disabled={loading || !text.trim()}
      >
        {loading ? "TTS 생성 중..." : "TTS 생성"}
      </button>

      {ttsSuccess && job?.tts && (
        <div className="mt-4 rounded-xl bg-[var(--success-bg)] p-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-[var(--success)]">
            <span>✓</span>
            <span>TTS 생성 완료</span>
            <span className="ml-auto tabular-nums">{job.tts.duration.toFixed(2)}초</span>
          </p>
          <audio className="mt-2 w-full" controls src={`/api/media/${job.job_id}/tts`} />
        </div>
      )}
    </section>
  );
}
