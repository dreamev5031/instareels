"use client";

import { useEffect, useRef, useState } from "react";
import type { BgmTrack } from "@/bgm/storage";
import type { BgmSettings, Job } from "@/shared/types";
import { API_BASE_URL, fetchBgmTracks, uploadBgm } from "@/ui/api";
import { ttsAudioSrc, ttsAudioVersion } from "@/tts/audioVersion";

function durationLabel(seconds?: number) {
  if (!seconds) return "길이 정보 없음";
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

function BgmSheet({
  tracks,
  selectedId,
  uploading,
  uploadStatus,
  onSelect,
  onRequestUpload,
  onClose,
}: {
  tracks: BgmTrack[];
  selectedId?: string;
  uploading: boolean;
  uploadStatus: { kind: "success" | "error"; message: string } | null;
  onSelect: (track: BgmTrack) => void;
  onRequestUpload: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 px-3" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="BGM 선택"
        className="mb-3 w-full max-w-[430px] overflow-hidden rounded-[24px] bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h3 className="font-bold">BGM 선택</h3>
          <button type="button" onClick={onClose} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold">
            닫기
          </button>
        </div>
        <div className="max-h-[65dvh] overflow-y-auto p-2">
          <div className="border-b border-[var(--border)] p-2">
            <button
              type="button"
              data-testid="bgm-upload-button"
              disabled={uploading}
              onClick={onRequestUpload}
              className="w-full rounded-xl bg-slate-100 py-2.5 text-sm font-semibold text-[var(--primary)] disabled:opacity-50"
            >
              {uploading ? "BGM 업로드 중..." : "+ BGM 업로드"}
            </button>
            {uploadStatus && (
              <p className={`mt-2 break-words text-center text-xs ${uploadStatus.kind === "success" ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
                {uploadStatus.message}
              </p>
            )}
          </div>
          {tracks.map((track) => {
            const selected = track.id === selectedId;
            return (
              <button
                type="button"
                key={track.id}
                data-testid={`bgm-option-${track.id}`}
                onClick={() => onSelect(track)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-3.5 text-left ${
                  selected ? "bg-indigo-50 text-[var(--primary)]" : "hover:bg-slate-50"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-[15px]">{track.name}</strong>
                  <span className="mt-0.5 block text-xs text-[var(--text-muted)]">{durationLabel(track.durationSeconds)}</span>
                </span>
                <span
                  aria-hidden="true"
                  className={`h-5 w-5 rounded-full border-[5px] ${
                    selected ? "border-[var(--primary)] bg-white" : "border-2 border-slate-300"
                  }`}
                />
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export default function BgmStep({
  job,
  saving,
  onSave,
  onDirtyChange,
}: {
  job: Job;
  saving: boolean;
  onSave: (settings: BgmSettings) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [settings, setSettings] = useState<BgmSettings>(job.bgm);
  const [tracks, setTracks] = useState<BgmTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const ttsAudio = useRef<HTMLAudioElement>(null);
  const bgmAudio = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    let active = true;
    fetchBgmTracks()
      .then((items) => {
        if (active) setTracks(items);
      })
      .catch(() => {
        if (active) setListError("BGM 목록을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setSettings(job.bgm);
  }, [job.job_id, job.bgm]);

  useEffect(() => {
    if (bgmAudio.current) bgmAudio.current.volume = settings.bgmVolume;
  }, [settings.bgmVolume]);

  function stopPreview(reset = false) {
    for (const audio of [ttsAudio.current, bgmAudio.current]) {
      if (!audio) continue;
      audio.pause();
      if (reset) audio.currentTime = 0;
    }
    setPlaying(false);
  }

  async function togglePreview() {
    if (playing) {
      stopPreview();
      return;
    }
    if (!settings.bgmEnabled || !settings.bgmId || !ttsAudio.current || !bgmAudio.current) return;
    ttsAudio.current.currentTime = 0;
    bgmAudio.current.currentTime = 0;
    ttsAudio.current.volume = 1;
    bgmAudio.current.volume = settings.bgmVolume;
    try {
      await Promise.all([ttsAudio.current.play(), bgmAudio.current.play()]);
      setPlaying(true);
    } catch {
      stopPreview(true);
    }
  }

  function selectTrack(track: BgmTrack) {
    stopPreview(true);
    setSettings((previous) => ({
      ...previous,
      bgmEnabled: true,
      bgmId: track.id,
      bgmName: track.name,
    }));
    onDirtyChange(true);
    setSheetOpen(false);
  }

  async function handleUpload(file: File) {
    stopPreview(true);
    setUploading(true);
    setUploadStatus(null);
    try {
      const result = await uploadBgm(file);
      setTracks(result.tracks);
      setSettings((previous) => ({
        ...previous,
        bgmEnabled: true,
        bgmId: result.track.id,
        bgmName: result.track.name,
      }));
      onDirtyChange(true);
      setUploadStatus({ kind: "success", message: "BGM 업로드 완료" });
    } catch (caught) {
      setUploadStatus({
        kind: "error",
        message: `BGM 업로드 실패 · ${caught instanceof Error ? caught.message : String(caught)}`,
      });
    } finally {
      setUploading(false);
      if (uploadInput.current) uploadInput.current.value = "";
    }
  }

  function disableBgm() {
    stopPreview(true);
    setSettings((previous) => ({ bgmEnabled: false, bgmVolume: previous.bgmVolume }));
    onDirtyChange(true);
  }

  const empty = !loading && !listError && tracks.length === 0;
  const previewReady = Boolean(settings.bgmEnabled && settings.bgmId && job.tts);
  const audioVersion = ttsAudioVersion(job.tts);

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm" data-testid="bgm-step">
      <div>
        <p className="text-[10px] font-bold tracking-[.14em] text-[var(--primary)]">BGM</p>
        <h2 className="mt-1 text-base font-bold">배경음악 설정</h2>
      </div>
      <p className="mt-1 text-xs text-[var(--text-muted)]">TTS 볼륨은 고정되며 BGM 볼륨만 조절됩니다.</p>
      <input
        ref={uploadInput}
        data-testid="bgm-upload-input"
        type="file"
        accept=".mp3,.wav,.m4a,.aac,audio/mpeg,audio/wav,audio/mp4,audio/aac"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleUpload(file);
        }}
      />

      <div className="mt-3 rounded-xl bg-slate-100 px-3 py-3">
        <span className="block text-[10px] text-[var(--text-muted)]">선택한 BGM</span>
        <strong className="mt-0.5 block truncate text-sm">
          {settings.bgmEnabled && settings.bgmName ? settings.bgmName : "선택 안 함"}
        </strong>
      </div>

      {empty ? (
        <div className="mt-3 rounded-xl bg-slate-50 px-3 py-3 text-center">
          <p className="text-sm text-[var(--text-muted)]">등록된 BGM이 없습니다.</p>
          <button
            type="button"
            data-testid="first-bgm-upload-button"
            disabled={uploading}
            onClick={() => uploadInput.current?.click()}
            className="mt-2 rounded-lg bg-white px-4 py-2 text-xs font-semibold text-[var(--primary)] shadow-sm disabled:opacity-50"
          >
            {uploading ? "BGM 업로드 중..." : "+ 첫 BGM 업로드"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          data-testid="bgm-picker"
          disabled={loading || Boolean(listError)}
          onClick={() => setSheetOpen(true)}
          className="mt-3 w-full rounded-xl border border-[var(--border)] bg-white py-3 text-sm font-semibold disabled:opacity-50"
        >
          {loading ? "BGM 불러오는 중…" : "BGM 선택"}
        </button>
      )}
      {listError && <p className="mt-2 text-center text-xs text-[var(--text-muted)]">{listError}</p>}
      {!sheetOpen && uploadStatus && (
        <p className={`mt-2 break-words text-center text-xs ${uploadStatus.kind === "success" ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
          {uploadStatus.message}
        </p>
      )}

      <button
        type="button"
        data-testid="bgm-preview"
        disabled={!previewReady}
        onClick={togglePreview}
        className="mt-2 w-full rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white disabled:opacity-40"
      >
        {playing ? "❚❚ 정지" : "▶ 미리듣기"}
      </button>

      <label className="mt-3 block rounded-xl bg-slate-100 px-3 py-2.5">
        <span className="flex items-center justify-between text-xs font-medium">
          <span>BGM 볼륨</span>
          <b className="tabular-nums">{Math.round(settings.bgmVolume * 100)}%</b>
        </span>
        <input
          data-testid="bgm-volume"
          type="range"
          min="0"
          max="0.5"
          step="0.01"
          value={settings.bgmVolume}
          onChange={(event) => {
            const volume = Number(event.target.value);
            setSettings((previous) => ({ ...previous, bgmVolume: volume }));
            if (bgmAudio.current) bgmAudio.current.volume = volume;
            onDirtyChange(true);
          }}
          className="mt-2 w-full accent-[var(--primary)]"
        />
      </label>

      {settings.bgmEnabled && (
        <button type="button" onClick={disableBgm} className="mt-2 w-full py-2 text-xs font-semibold text-[var(--text-muted)]">
          BGM 사용 안 함
        </button>
      )}
      <button
        type="button"
        data-testid="save-bgm-button"
        disabled={saving || loading || Boolean(listError)}
        onClick={async () => {
          await onSave(settings);
          onDirtyChange(false);
        }}
        className="mt-1 w-full rounded-xl bg-[var(--primary)] py-3 text-sm font-semibold text-white disabled:opacity-50"
      >
        {saving ? "BGM 저장 중…" : "BGM 설정 적용"}
      </button>

      <audio
        key={audioVersion}
        ref={ttsAudio}
        preload="metadata"
        src={ttsAudioSrc(API_BASE_URL, job.job_id, job.tts)}
        onEnded={() => stopPreview(true)}
      />
      {settings.bgmId && (
        <audio
          key={settings.bgmId}
          ref={bgmAudio}
          preload="metadata"
          loop
          src={`${API_BASE_URL}/api/bgm/${settings.bgmId}/stream`}
        />
      )}
      {sheetOpen && (
        <BgmSheet
          tracks={tracks}
          selectedId={settings.bgmId}
          uploading={uploading}
          uploadStatus={uploadStatus}
          onSelect={selectTrack}
          onRequestUpload={() => uploadInput.current?.click()}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </section>
  );
}
