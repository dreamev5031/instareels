"use client";

import { useEffect, useMemo, useState } from "react";
import { COVER_FONTS, coverFontFamily } from "@/cover/fonts";
import {
  CoverFontKey,
  CoverSettings,
  CoverVerticalPosition,
  Job,
} from "@/shared/types";
import { API_BASE_URL } from "@/ui/api";

type EditableCoverSettings = Omit<CoverSettings, "image">;

interface Props {
  job: Job;
  saving: boolean;
  onSave: (file: File | null, settings: EditableCoverSettings) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}

const POSITION_LABELS: Record<CoverVerticalPosition, string> = {
  top: "상단",
  middle: "중단",
  bottom: "하단",
};

function CoverPreview({
  imageUrl,
  settings,
  compact = false,
}: {
  imageUrl: string | null;
  settings: EditableCoverSettings;
  compact?: boolean;
}) {
  const positionClass =
    settings.vertical_position === "top"
      ? "top-[11%]"
      : settings.vertical_position === "middle"
        ? "top-1/2 -translate-y-1/2"
        : "bottom-[11%]";
  const textEffect = {
    color: settings.text_color,
    textShadow: settings.shadow_enabled ? "0 2px 8px rgba(0,0,0,.85)" : "none",
    WebkitTextStroke: settings.stroke_enabled ? (compact ? "0.35px rgba(0,0,0,.8)" : "0.65px rgba(0,0,0,.8)") : "0px transparent",
  };

  return (
    <div
      data-testid="cover-preview"
      className={`${compact ? "w-[62px]" : "w-[min(58vw,218px)]"} relative aspect-[9/16] shrink-0 overflow-hidden rounded-[18px] bg-slate-900 shadow-[0_18px_45px_rgba(15,23,42,.2)] ring-1 ring-black/10`}
    >
      {imageUrl ? (
        <img src={imageUrl} alt="앞표지 미리보기" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-slate-800 to-slate-950 px-5 text-center text-white/60">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="mb-2 h-8 w-8 fill-none stroke-current" strokeWidth="1.5">
            <path d="M4 16.5 8.5 12l3 3 2-2 6.5 6.5M5.5 4.5h13a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Z" />
            <circle cx="15.5" cy="8.5" r="1.5" />
          </svg>
          {!compact && <span className="text-xs font-medium leading-relaxed">이미지를 선택하면<br />바로 표시돼요</span>}
        </div>
      )}

      {(settings.main_text || settings.sub_text) && (
        <div className={`absolute inset-x-[8%] ${positionClass} text-center`} style={textEffect}>
          {settings.main_text && (
            <p
              data-testid="cover-main-preview"
              className={`${compact ? "text-[6px] leading-tight" : "text-[clamp(1rem,5.2vw,1.45rem)] leading-[1.2]"} whitespace-pre-wrap break-words font-extrabold [overflow-wrap:anywhere]`}
              style={{ fontFamily: coverFontFamily(settings.main_font) }}
            >
              {settings.main_text}
            </p>
          )}
          {settings.sub_text && (
            <p
              data-testid="cover-sub-preview"
              className={`${compact ? "mt-0.5 text-[4px] leading-tight" : "mt-2 text-[clamp(.68rem,3.2vw,.9rem)] leading-[1.35]"} whitespace-pre-wrap break-words font-bold [overflow-wrap:anywhere]`}
              style={{ fontFamily: coverFontFamily(settings.sub_font) }}
            >
              {settings.sub_text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function FontPicker({
  selected,
  title,
  onSelect,
  onClose,
}: {
  selected: CoverFontKey;
  title: string;
  onSelect: (font: CoverFontKey) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 px-3" role="presentation" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="mb-3 w-full max-w-[430px] overflow-hidden rounded-[24px] bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h3 className="font-bold">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold">닫기</button>
        </div>
        <div className="max-h-[65dvh] overflow-y-auto p-2">
          {COVER_FONTS.map((font) => (
            <button
              type="button"
              key={font.key}
              data-testid={`font-option-${font.key}`}
              onClick={() => {
                onSelect(font.key);
                onClose();
              }}
              className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-[15px] ${selected === font.key ? "bg-indigo-50 text-[var(--primary)]" : "hover:bg-slate-50"}`}
              style={{ fontFamily: font.family }}
            >
              <span>{font.label}</span>
              {selected === font.key && <span className="text-sm font-bold">✓</span>}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function selectedFontLabel(key: CoverFontKey): string {
  return COVER_FONTS.find((font) => font.key === key)?.label ?? "Pretendard";
}

export default function CoverStep({ job, saving, onSave, onDirtyChange }: Props) {
  const { image: _image, ...savedSettings } = job.cover;
  const [settings, setSettings] = useState<EditableCoverSettings>(savedSettings);
  const [file, setFile] = useState<File | null>(null);
  const [localImageUrl, setLocalImageUrl] = useState<string | null>(null);
  const [picker, setPicker] = useState<"main" | "sub" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(job.stages.COVER.status !== "SUCCESS");

  const storedImageUrl = job.cover.image
    ? `${API_BASE_URL}/api/media/${job.job_id}/cover?v=${encodeURIComponent(job.updated_at)}`
    : null;
  const imageUrl = localImageUrl ?? storedImageUrl;
  const complete = job.stages.COVER.status === "SUCCESS";

  useEffect(() => {
    return () => {
      if (localImageUrl) URL.revokeObjectURL(localImageUrl);
    };
  }, [localImageUrl]);

  const effectiveSettings = useMemo(
    () => ({
      ...settings,
      sub_font: settings.use_same_font ? settings.main_font : settings.sub_font,
    }),
    [settings],
  );

  function updateSetting<K extends keyof EditableCoverSettings>(key: K, value: EditableCoverSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
    setError(null);
    onDirtyChange(true);
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!selected) return;
    if (selected.size > 20 * 1024 * 1024) {
      setError("앞표지 이미지는 최대 20MB까지 업로드할 수 있습니다.");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(selected.type)) {
      setError("JPG, PNG, WebP 이미지만 업로드할 수 있습니다.");
      return;
    }
    if (localImageUrl) URL.revokeObjectURL(localImageUrl);
    setFile(selected);
    setLocalImageUrl(URL.createObjectURL(selected));
    setError(null);
    onDirtyChange(true);
  }

  async function handleSave() {
    if (!imageUrl) {
      setError("앞표지 이미지를 선택해 주세요.");
      return;
    }
    setError(null);
    try {
      await onSave(file, effectiveSettings);
      setFile(null);
      setExpanded(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "앞표지를 저장하지 못했습니다.");
    }
  }

  if (complete && !expanded) {
    return (
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm" data-testid="cover-step-collapsed">
        <div className="flex items-center gap-3">
          <CoverPreview imageUrl={imageUrl} settings={effectiveSettings} compact />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-[var(--success)]">앞표지 준비 완료</p>
            <p className="mt-1 truncate text-sm font-bold">{settings.main_text || "문구 없음"}</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {selectedFontLabel(settings.main_font)} · {POSITION_LABELS[settings.vertical_position]}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="shrink-0 rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold"
          >
            편집
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm" data-testid="cover-step">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--primary)] text-xs font-semibold text-white">2</span>
        <div>
          <h2 className="text-base font-semibold">앞표지 만들기</h2>
          <p className="text-[11px] text-[var(--text-muted)]">1080×1920 비율로 미리 보여드려요</p>
        </div>
      </div>

      <div className="flex justify-center rounded-2xl bg-slate-100/80 py-4">
        <CoverPreview imageUrl={imageUrl} settings={effectiveSettings} />
      </div>

      <div className="mt-4 rounded-xl border border-[var(--border)] p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">앞표지 이미지 <span className="text-[var(--danger)]">필수</span></p>
            <p data-testid="cover-file-name" className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">
              {file?.name ?? job.cover.image?.original_filename ?? "JPG, PNG, WebP · 최대 20MB"}
            </p>
          </div>
          <label className="shrink-0 cursor-pointer rounded-xl bg-slate-900 px-3.5 py-2.5 text-xs font-semibold text-white active:scale-[0.98]">
            이미지 선택
            <input data-testid="cover-file-input" type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleFileChange} />
          </label>
        </div>
      </div>

      <div className="mt-3 space-y-2.5 rounded-xl border border-[var(--border)] p-3">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold">메인 문구</span>
          <textarea
            data-testid="cover-main-input"
            value={settings.main_text}
            maxLength={80}
            rows={2}
            onChange={(event) => updateSetting("main_text", event.target.value)}
            placeholder="가장 눈에 띄는 문구"
            className="w-full resize-none rounded-xl border border-[var(--border)] px-3 py-2.5 text-sm leading-relaxed outline-none focus:border-[var(--primary)]"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold">서브 문구</span>
          <textarea
            data-testid="cover-sub-input"
            value={settings.sub_text}
            maxLength={120}
            rows={2}
            onChange={(event) => updateSetting("sub_text", event.target.value)}
            placeholder="메인 문구를 보완하는 짧은 설명"
            className="w-full resize-none rounded-xl border border-[var(--border)] px-3 py-2.5 text-sm leading-relaxed outline-none focus:border-[var(--primary)]"
          />
        </label>
      </div>

      <div className="mt-3 rounded-xl border border-[var(--border)] p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold">폰트</p>
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            같은 폰트 사용
            <button
              type="button"
              role="switch"
              aria-checked={settings.use_same_font}
              data-testid="same-font-toggle"
              onClick={() => updateSetting("use_same_font", !settings.use_same_font)}
              className={`relative h-6 w-11 rounded-full transition ${settings.use_same_font ? "bg-[var(--primary)]" : "bg-slate-300"}`}
            >
              <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${settings.use_same_font ? "left-6" : "left-1"}`} />
            </button>
          </div>
        </div>
        <button
          type="button"
          data-testid="main-font-picker"
          onClick={() => setPicker("main")}
          className="mt-2 flex w-full items-center justify-between rounded-xl bg-slate-100 px-3 py-2.5 text-left text-sm"
        >
          <span className="text-xs text-[var(--text-muted)]">{settings.use_same_font ? "문구 폰트" : "메인 폰트"}</span>
          <span className="font-semibold" style={{ fontFamily: coverFontFamily(settings.main_font) }}>{selectedFontLabel(settings.main_font)} 〉</span>
        </button>
        {!settings.use_same_font && (
          <button
            type="button"
            data-testid="sub-font-picker"
            onClick={() => setPicker("sub")}
            className="mt-2 flex w-full items-center justify-between rounded-xl bg-slate-100 px-3 py-2.5 text-left text-sm"
          >
            <span className="text-xs text-[var(--text-muted)]">서브 폰트</span>
            <span className="font-semibold" style={{ fontFamily: coverFontFamily(settings.sub_font) }}>{selectedFontLabel(settings.sub_font)} 〉</span>
          </button>
        )}
      </div>

      <div className="mt-3 rounded-xl border border-[var(--border)] p-3">
        <p className="text-xs font-semibold">세로 위치</p>
        <div className="mt-2 grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1" data-testid="vertical-position-control">
          {(Object.keys(POSITION_LABELS) as CoverVerticalPosition[]).map((position) => (
            <button
              type="button"
              key={position}
              data-testid={`position-${position}`}
              aria-pressed={settings.vertical_position === position}
              onClick={() => updateSetting("vertical_position", position)}
              className={`rounded-lg py-2.5 text-xs font-semibold transition ${settings.vertical_position === position ? "bg-white text-[var(--primary)] shadow-sm" : "text-[var(--text-muted)]"}`}
            >
              {POSITION_LABELS[position]}
            </button>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl bg-slate-100 px-3 text-xs font-semibold">
            <input
              data-testid="cover-color-input"
              type="color"
              value={settings.text_color}
              onChange={(event) => updateSetting("text_color", event.target.value)}
              className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
            />
            글자색
          </label>
          <button
            type="button"
            aria-pressed={settings.shadow_enabled}
            onClick={() => updateSetting("shadow_enabled", !settings.shadow_enabled)}
            className={`h-10 rounded-xl px-3 text-xs font-semibold ${settings.shadow_enabled ? "bg-indigo-50 text-[var(--primary)]" : "bg-slate-100 text-[var(--text-muted)]"}`}
          >
            그림자 {settings.shadow_enabled ? "ON" : "OFF"}
          </button>
          <button
            type="button"
            aria-pressed={settings.stroke_enabled}
            onClick={() => updateSetting("stroke_enabled", !settings.stroke_enabled)}
            className={`h-10 rounded-xl px-3 text-xs font-semibold ${settings.stroke_enabled ? "bg-indigo-50 text-[var(--primary)]" : "bg-slate-100 text-[var(--text-muted)]"}`}
          >
            외곽선 {settings.stroke_enabled ? "ON" : "OFF"}
          </button>
        </div>
      </div>

      {error && (
        <p data-testid="cover-error" role="alert" className="mt-3 rounded-xl bg-[var(--danger-bg)] px-3 py-2.5 text-xs font-medium text-[var(--danger)]">
          {error}
        </p>
      )}

      <button
        type="button"
        data-testid="save-cover-button"
        onClick={handleSave}
        disabled={saving}
        className="mt-3 w-full rounded-xl bg-[var(--primary)] py-3 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-50"
      >
        {saving ? "앞표지 저장 중..." : complete ? "변경사항 적용" : "앞표지 적용"}
      </button>

      {picker && (
        <FontPicker
          selected={picker === "main" ? settings.main_font : settings.sub_font}
          title={picker === "main" ? "메인 폰트 선택" : "서브 폰트 선택"}
          onSelect={(font) => updateSetting(picker === "main" ? "main_font" : "sub_font", font)}
          onClose={() => setPicker(null)}
        />
      )}
    </section>
  );
}
