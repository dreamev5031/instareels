"use client";

import { useEffect, useState } from "react";
import { Job, TtsProviderName } from "@/shared/types";
import { SUPPORTED_VOICES } from "@/tts/voices";
import { API_BASE_URL, fetchElevenLabsVoices } from "@/ui/api";
import type { ElevenLabsVoiceEntry } from "@/voices/storage";
import VoiceSheet from "./VoiceSheet";

interface Props {
  text: string;
  onTextChange: (v: string) => void;
  provider: TtsProviderName;
  onProviderChange: (provider: TtsProviderName) => void;
  voice: string;
  voiceLabel: string;
  onVoiceChange: (voice: string, label: string) => void;
  loading: boolean;
  job: Job | null;
  onGenerate: () => void;
}

export default function TtsStep({
  text,
  onTextChange,
  provider,
  onProviderChange,
  voice,
  voiceLabel,
  onVoiceChange,
  loading,
  job,
  onGenerate,
}: Props) {
  const ttsSuccess = job?.stages.TTS.status === "SUCCESS" && job.tts;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [elevenLabsVoices, setElevenLabsVoices] = useState<ElevenLabsVoiceEntry[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [voicesError, setVoicesError] = useState<string | null>(null);

  useEffect(() => {
    if (provider !== "elevenlabs") return;
    let active = true;
    setVoicesLoading(true);
    setVoicesError(null);
    fetchElevenLabsVoices()
      .then((items) => {
        if (active) setElevenLabsVoices(items);
      })
      .catch(() => {
        if (active) setVoicesError("목소리 목록을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (active) setVoicesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [provider]);

  function handleProviderToggle() {
    const next: TtsProviderName = provider === "elevenlabs" ? "edge" : "elevenlabs";
    onProviderChange(next);
    if (next === "edge") {
      const first = SUPPORTED_VOICES[0]!;
      onVoiceChange(first.shortName, first.friendlyName);
    } else {
      onVoiceChange("", "");
    }
  }

  const voiceButtonLabel =
    provider === "edge"
      ? voiceLabel || SUPPORTED_VOICES[0]!.friendlyName
      : voiceLabel || (voicesLoading ? "불러오는 중..." : elevenLabsVoices.length === 0 ? "등록된 목소리 없음" : "목소리 선택");

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

      <label className="mt-3 flex items-center justify-between rounded-xl bg-slate-100 px-3 py-2.5">
        <span className="text-xs font-semibold">ElevenLabs TTS</span>
        <button
          type="button"
          role="switch"
          aria-checked={provider === "elevenlabs"}
          data-testid="elevenlabs-toggle"
          disabled={loading}
          onClick={handleProviderToggle}
          className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
            provider === "elevenlabs" ? "bg-[var(--primary)]" : "bg-slate-300"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
              provider === "elevenlabs" ? "left-[22px]" : "left-0.5"
            }`}
          />
        </button>
      </label>

      <div className="mt-3 flex items-center gap-2">
        <label className="shrink-0 text-xs font-medium text-[var(--text-muted)]">목소리</label>
        <button
          type="button"
          data-testid="voice-picker"
          onClick={() => setSheetOpen(true)}
          disabled={loading}
          className="min-w-0 flex-1 truncate rounded-lg border border-[var(--border)] bg-white px-2.5 py-2 text-left text-sm outline-none disabled:opacity-50"
        >
          {voiceButtonLabel}
        </button>
      </div>

      <button
        className="mt-3 w-full rounded-xl bg-[var(--primary)] py-3 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-50"
        onClick={onGenerate}
        disabled={loading || !text.trim() || !voice}
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
          <audio className="mt-2 w-full" controls src={`${API_BASE_URL}/api/media/${job.job_id}/tts`} />
        </div>
      )}

      {sheetOpen && (
        <VoiceSheet
          provider={provider}
          selectedVoice={voice}
          voices={elevenLabsVoices}
          loading={voicesLoading}
          listError={voicesError}
          onVoicesChange={setElevenLabsVoices}
          onSelectEdge={(shortName, friendlyName) => {
            onVoiceChange(shortName, friendlyName);
            setSheetOpen(false);
          }}
          onSelectElevenLabs={(entry) => {
            onVoiceChange(entry.voiceId, entry.alias);
            setSheetOpen(false);
          }}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </section>
  );
}
