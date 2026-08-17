"use client";

import { useRef, useState } from "react";
import { SUPPORTED_VOICES } from "@/tts/voices";
import { deleteElevenLabsVoice, previewElevenLabsVoice, registerElevenLabsVoice } from "@/ui/api";
import type { ElevenLabsVoiceEntry } from "@/voices/storage";
import type { TtsProviderName } from "@/shared/types";

export default function VoiceSheet({
  provider,
  selectedVoice,
  voices,
  loading,
  listError,
  onVoicesChange,
  onSelectEdge,
  onSelectElevenLabs,
  onClose,
}: {
  provider: TtsProviderName;
  selectedVoice: string;
  voices: ElevenLabsVoiceEntry[];
  loading: boolean;
  listError: string | null;
  onVoicesChange: (voices: ElevenLabsVoiceEntry[]) => void;
  onSelectEdge: (shortName: string, friendlyName: string) => void;
  onSelectElevenLabs: (entry: ElevenLabsVoiceEntry) => void;
  onClose: () => void;
}) {
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [voiceIdInput, setVoiceIdInput] = useState("");
  const [aliasInput, setAliasInput] = useState("");
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  function stopPreview() {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setPlayingId(null);
  }

  // Always plays the clicked entry's own voiceId/previewUrl — never an
  // ambiguous "currently selected" voice — and always fully resets the
  // shared <audio> element first so a previous voice's buffered audio can
  // never bleed into this playback.
  async function togglePreview(entry: ElevenLabsVoiceEntry) {
    if (playingId === entry.id) {
      stopPreview();
      return;
    }
    stopPreview();
    setActionError(null);
    setPreviewLoadingId(entry.id);
    try {
      let src = entry.previewUrl;
      if (!src) {
        const result = await previewElevenLabsVoice(entry.id);
        src = result.previewUrl || (result.audioBase64 ? `data:${result.mimeType ?? "audio/mpeg"};base64,${result.audioBase64}` : undefined);
      }
      if (!src) throw new Error("미리듣기를 불러오지 못했습니다.");
      const audio = audioRef.current ?? (audioRef.current = new Audio());
      audio.pause();
      audio.currentTime = 0;
      audio.removeAttribute("src");
      audio.load();
      audio.src = src;
      audio.load();
      audio.onended = () => setPlayingId(null);
      await audio.play();
      setPlayingId(entry.id);
    } catch {
      setActionError("미리듣기를 불러오지 못했습니다.");
    } finally {
      setPreviewLoadingId(null);
    }
  }

  async function handleRegister() {
    setRegisterError(null);
    const voiceId = voiceIdInput.trim();
    const alias = aliasInput.trim();
    if (!voiceId) {
      setRegisterError("Voice ID를 입력해 주세요.");
      return;
    }
    if (!alias) {
      setRegisterError("별명을 입력해 주세요.");
      return;
    }
    setRegistering(true);
    try {
      const entry = await registerElevenLabsVoice(voiceId, alias);
      const existingIndex = voices.findIndex((voice) => voice.voiceId === entry.voiceId || voice.id === entry.id);
      if (existingIndex >= 0) {
        const next = [...voices];
        next[existingIndex] = entry;
        onVoicesChange(next);
      } else {
        onVoicesChange([...voices, entry]);
      }
      setVoiceIdInput("");
      setAliasInput("");
      setShowRegisterForm(false);
      onSelectElevenLabs(entry);
    } catch (caught) {
      setRegisterError(caught instanceof Error ? caught.message : "Voice 등록에 실패했습니다.");
    } finally {
      setRegistering(false);
    }
  }

  async function handleDelete(entry: ElevenLabsVoiceEntry, event: React.MouseEvent) {
    event.stopPropagation();
    if (typeof window !== "undefined" && !window.confirm(`"${entry.alias}"을(를) 삭제할까요?`)) return;
    setActionError(null);
    try {
      await deleteElevenLabsVoice(entry.id);
      if (playingId === entry.id) stopPreview();
      onVoicesChange(voices.filter((v) => v.id !== entry.id));
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "삭제에 실패했습니다.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 px-3" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="목소리 선택"
        className="mb-3 w-full max-w-[430px] overflow-hidden rounded-[24px] bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h3 className="font-bold">목소리 선택</h3>
          <button type="button" onClick={onClose} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold">
            닫기
          </button>
        </div>
        <div className="max-h-[65dvh] overflow-y-auto p-2">
          {provider === "edge" ? (
            SUPPORTED_VOICES.map((v) => {
              const selected = v.shortName === selectedVoice;
              return (
                <button
                  type="button"
                  key={v.shortName}
                  data-testid={`voice-option-${v.shortName}`}
                  onClick={() => onSelectEdge(v.shortName, v.friendlyName)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-3.5 text-left ${
                    selected ? "bg-indigo-50 text-[var(--primary)]" : "hover:bg-slate-50"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-[15px]">{v.friendlyName}</strong>
                  </span>
                  <span
                    aria-hidden="true"
                    className={`h-5 w-5 shrink-0 rounded-full border-[5px] ${
                      selected ? "border-[var(--primary)] bg-white" : "border-2 border-slate-300"
                    }`}
                  />
                </button>
              );
            })
          ) : (
            <>
              <div className="border-b border-[var(--border)] p-2">
                <button
                  type="button"
                  data-testid="voice-register-toggle"
                  onClick={() => setShowRegisterForm((v) => !v)}
                  className="w-full rounded-xl bg-slate-100 py-2.5 text-sm font-semibold text-[var(--primary)]"
                >
                  {showRegisterForm ? "취소" : "+ Voice ID 등록"}
                </button>
                {showRegisterForm && (
                  <div className="mt-2 space-y-2 rounded-xl bg-slate-50 p-3">
                    <label className="block text-xs font-medium text-[var(--text-muted)]">
                      Voice ID
                      <input
                        data-testid="voice-id-input"
                        value={voiceIdInput}
                        onChange={(e) => setVoiceIdInput(e.target.value)}
                        placeholder="21m00Tcm4TlvDq8ikWAM"
                        className="mt-1 w-full rounded-lg border border-[var(--border)] bg-white px-2.5 py-2 text-sm outline-none focus:border-[var(--primary)]"
                      />
                    </label>
                    <label className="block text-xs font-medium text-[var(--text-muted)]">
                      별명
                      <input
                        data-testid="voice-alias-input"
                        value={aliasInput}
                        onChange={(e) => setAliasInput(e.target.value)}
                        placeholder="쇼핑 여자 1"
                        className="mt-1 w-full rounded-lg border border-[var(--border)] bg-white px-2.5 py-2 text-sm outline-none focus:border-[var(--primary)]"
                      />
                    </label>
                    {registerError && <p className="break-words text-xs text-[var(--danger)]">{registerError}</p>}
                    <button
                      type="button"
                      data-testid="voice-register-submit"
                      disabled={registering}
                      onClick={handleRegister}
                      className="w-full rounded-lg bg-[var(--primary)] py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {registering ? "등록 중..." : "등록"}
                    </button>
                  </div>
                )}
              </div>

              {loading && <p className="p-4 text-center text-xs text-[var(--text-muted)]">불러오는 중...</p>}
              {listError && <p className="p-4 text-center text-xs text-[var(--danger)]">{listError}</p>}
              {actionError && <p className="px-4 pt-2 text-center text-xs text-[var(--danger)]">{actionError}</p>}
              {!loading && !listError && voices.length === 0 && (
                <p className="p-4 text-center text-xs text-[var(--text-muted)]">등록된 ElevenLabs 목소리가 없습니다.</p>
              )}
              {voices.map((entry) => {
                const selected = entry.voiceId === selectedVoice;
                return (
                  <div
                    key={entry.id}
                    data-testid={`voice-option-${entry.id}`}
                    className={`flex w-full items-center gap-2 rounded-xl px-2 py-2.5 ${selected ? "bg-indigo-50" : ""}`}
                  >
                    <button
                      type="button"
                      data-testid={`voice-preview-${entry.id}`}
                      onClick={() => togglePreview(entry)}
                      disabled={previewLoadingId === entry.id}
                      className="shrink-0 rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold text-[var(--primary)] disabled:opacity-50"
                    >
                      {previewLoadingId === entry.id ? "..." : playingId === entry.id ? "❚❚" : "▶"}
                    </button>
                    <button
                      type="button"
                      onClick={() => onSelectElevenLabs(entry)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <strong className={`block truncate text-[15px] ${selected ? "text-[var(--primary)]" : ""}`}>{entry.alias}</strong>
                    </button>
                    <button
                      type="button"
                      aria-label={`${entry.alias} 선택`}
                      onClick={() => onSelectElevenLabs(entry)}
                      className={`h-5 w-5 shrink-0 rounded-full border-[5px] ${
                        selected ? "border-[var(--primary)] bg-white" : "border-2 border-slate-300"
                      }`}
                    />
                    <button
                      type="button"
                      data-testid={`voice-delete-${entry.id}`}
                      onClick={(event) => handleDelete(entry, event)}
                      aria-label={`${entry.alias} 삭제`}
                      className="shrink-0 px-1.5 text-lg leading-none text-[var(--text-muted)]"
                    >
                      ⋯
                    </button>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
