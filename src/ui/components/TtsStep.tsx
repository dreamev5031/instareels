"use client";

import { useEffect, useRef, useState } from "react";
import { Job, TtsProviderName } from "@/shared/types";
import { SUPPORTED_VOICES } from "@/tts/voices";
import { API_BASE_URL, fetchElevenLabsVoices } from "@/ui/api";
import { ttsAudioSrc, ttsAudioVersion } from "@/tts/audioVersion";
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

const LAST_ELEVENLABS_VOICE_KEY = "instareels.lastElevenLabsVoice";

function readLastElevenLabsVoice(): { voiceId: string; alias: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_ELEVENLABS_VOICE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { voiceId?: unknown; alias?: unknown };
    if (typeof parsed.voiceId === "string" && typeof parsed.alias === "string") {
      return { voiceId: parsed.voiceId, alias: parsed.alias };
    }
  } catch {
    // Corrupt/unexpected localStorage content — treat as "nothing remembered".
  }
  return null;
}

function writeLastElevenLabsVoice(voiceId: string, alias: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_ELEVENLABS_VOICE_KEY, JSON.stringify({ voiceId, alias }));
  } catch {
    // Storage unavailable (private mode, quota) — losing the "remember last voice"
    // convenience is fine, the app still works without it.
  }
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

  // Read inside the async fetch callback below instead of the effect's
  // closure, so a voice picked while the list was still loading is never
  // clobbered by an auto-select that started before the pick happened.
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  function selectElevenLabsVoice(entry: ElevenLabsVoiceEntry) {
    onVoiceChange(entry.voiceId, entry.alias);
    writeLastElevenLabsVoice(entry.voiceId, entry.alias);
  }

  useEffect(() => {
    if (provider !== "elevenlabs") return;
    let active = true;
    setVoicesLoading(true);
    setVoicesError(null);
    fetchElevenLabsVoices()
      .then((items) => {
        if (!active) return;
        setElevenLabsVoices(items);
        // Auto-select per spec: prefer the voice the user picked last time,
        // otherwise the first registered voice. Never leaves a stale Edge
        // voiceId in place, and never silently falls back to Edge.
        if (!voiceRef.current && items.length > 0) {
          const last = readLastElevenLabsVoice();
          const match = last ? items.find((entry) => entry.voiceId === last.voiceId) : undefined;
          selectElevenLabsVoice(match ?? items[0]!);
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  function handleProviderToggle() {
    const next: TtsProviderName = provider === "elevenlabs" ? "edge" : "elevenlabs";
    onProviderChange(next);
    if (next === "edge") {
      // Switching to Edge must never keep an ElevenLabs voiceId around.
      const first = SUPPORTED_VOICES[0]!;
      onVoiceChange(first.shortName, first.friendlyName);
    } else {
      // Switching to ElevenLabs must never keep an Edge voiceId around.
      // Try an immediate synchronous pick from any already-cached list
      // (avoids a visible "등록된 목소리 없음" flash on toggle); the fetch
      // effect above still runs and handles the first-ever load.
      const last = readLastElevenLabsVoice();
      const match = last ? elevenLabsVoices.find((entry) => entry.voiceId === last.voiceId) : undefined;
      const chosen = match ?? elevenLabsVoices[0];
      if (chosen) selectElevenLabsVoice(chosen);
      else onVoiceChange("", "");
    }
  }

  const voiceButtonLabel =
    provider === "edge"
      ? voiceLabel || SUPPORTED_VOICES[0]!.friendlyName
      : voiceLabel || (voicesLoading ? "불러오는 중..." : elevenLabsVoices.length === 0 ? "등록된 목소리 없음" : "목소리 선택");

  const audioVersion = ttsAudioVersion(job?.tts);
  const audioSrc = job ? ttsAudioSrc(API_BASE_URL, job.job_id, job.tts) : "";

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
          <audio key={audioVersion} className="mt-2 w-full" controls src={audioSrc} />
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
            selectElevenLabsVoice(entry);
            setSheetOpen(false);
          }}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </section>
  );
}
