"use client";

import { useEffect, useMemo, useState } from "react";
import { COVER_FONTS, coverFontFamily } from "@/cover/fonts";
import type { CoverFontKey, Job, SubtitleEffect, SubtitleSettings, SubtitleVerticalPosition } from "@/shared/types";
import {
  SUBTITLE_EFFECT_SPECS,
  SUBTITLE_EFFECT_SPEC_BY_ID,
  SUBTITLE_LINE_HEIGHT,
  subtitlePreviewText,
  subtitleYPercent,
} from "@/subtitle/spec";

const POSITION_LABELS: Record<SubtitleVerticalPosition, string> = { top: "상단", middle: "중단", bottom: "하단" };

function FontSheet({ selected, onSelect, onClose }: { selected: CoverFontKey; onSelect: (font: CoverFontKey) => void; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 px-3" onMouseDown={onClose}>
    <section role="dialog" aria-modal="true" aria-label="자막 폰트 선택" className="mb-3 w-full max-w-[430px] overflow-hidden rounded-[24px] bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4"><h3 className="font-bold">자막 폰트</h3><button type="button" onClick={onClose} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold">닫기</button></div>
      <div className="max-h-[65dvh] overflow-y-auto p-2">{COVER_FONTS.map((font) => <button type="button" key={font.key} data-testid={`subtitle-font-${font.key}`} onClick={() => { onSelect(font.key); onClose(); }} className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-[15px] ${selected === font.key ? "bg-indigo-50 text-[var(--primary)]" : "hover:bg-slate-50"}`} style={{ fontFamily: font.family }}><span>{font.label}</span>{selected === font.key && <span>✓</span>}</button>)}</div>
    </section>
  </div>;
}

function PreviewEffectText({ text, effect }: { text: string; effect: SubtitleEffect }) {
  const spec = SUBTITLE_EFFECT_SPEC_BY_ID[effect];
  if (spec.animationUnit === "word") {
    let wordIndex = 0;
    return <>{text.split(/(\s+)/u).map((piece, index) => {
      if (!piece || /^\s+$/u.test(piece)) return <span key={`space-${index}`}>{piece}</span>;
      const current = wordIndex++;
      return <span key={`word-${index}`} className="subtitle-preview-word" style={{ "--word-delay": `${current * 0.42}s` } as React.CSSProperties}>{piece}</span>;
    })}</>;
  }
  if (spec.animationUnit === "phrase") return <span className="subtitle-preview-line">{text}</span>;
  let visibleIndex = 0;
  return <>
    {Array.from(text).map((character, index) => {
      const currentVisible = character.trim() ? visibleIndex : Math.max(0, visibleIndex - 1);
      if (character.trim()) visibleIndex += 1;
      return <span
        key={`glyph-${index}`}
        className="subtitle-preview-glyph"
        style={{
          "--glyph-delay": `${currentVisible * 0.075}s`,
          "--glyph-delay-fast": `${currentVisible * 0.045}s`,
        } as React.CSSProperties}
      >{character}</span>;
    })}
    {effect === "typewriter" && <span className="subtitle-cursor" aria-hidden="true">|</span>}
  </>;
}

export default function SubtitleStep({ job, saving, onSave, onDirtyChange }: { job: Job; saving: boolean; onSave: (settings: SubtitleSettings) => Promise<void>; onDirtyChange: (dirty: boolean) => void }) {
  const [settings, setSettings] = useState(job.subtitle.settings);
  const [fontOpen, setFontOpen] = useState(false);
  const [replay, setReplay] = useState(0);
  const saved = job.subtitle.status === "SUCCESS";
  const previewSource = useMemo(() => job.subtitle.segments[0]?.text || job.tts?.text || "자막 미리보기", [job]);
  const previewText = useMemo(() => subtitlePreviewText(previewSource, settings.size), [previewSource, settings.size]);
  const selectedFont = COVER_FONTS.find((font) => font.key === settings.font) ?? COVER_FONTS[1]!;
  const effectSpec = SUBTITLE_EFFECT_SPEC_BY_ID[settings.effect];
  const update = <K extends keyof SubtitleSettings>(key: K, value: SubtitleSettings[K]) => {
    setSettings((previous) => ({ ...previous, [key]: value }));
    onDirtyChange(true);
    if (key === "effect") setReplay((value) => value + 1);
  };
  useEffect(() => { setSettings(job.subtitle.settings); }, [job.job_id, job.subtitle.settings]);

  const scale = settings.size / 104;
  return <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm" data-testid="subtitle-step">
    <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-bold tracking-[.14em] text-[var(--primary)]">SUBTITLE</p><h2 className="mt-1 text-base font-bold">자막 설정</h2></div><button type="button" role="switch" aria-checked={settings.enabled} data-testid="subtitle-toggle" onClick={() => update("enabled", !settings.enabled)} className={`relative h-7 w-12 rounded-full transition ${settings.enabled ? "bg-[var(--primary)]" : "bg-slate-300"}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${settings.enabled ? "left-6" : "left-1"}`} /></button></div>
    <p className="mt-1 text-xs text-[var(--text-muted)]">TTS 타이밍 기준으로 영상 장면과 독립적으로 표시됩니다.</p>

    <div className="mt-3 flex justify-center rounded-2xl bg-slate-950 p-3">
      <div className="relative aspect-[9/16] w-[min(52vw,190px)] overflow-hidden rounded-xl bg-gradient-to-br from-slate-700 via-slate-900 to-black" data-testid="subtitle-preview">
        {settings.enabled && <div key={`${settings.effect}-${replay}`} className={`subtitle-preview-effect ${effectSpec.previewClass} absolute inset-x-[6%] -translate-y-1/2 whitespace-pre-line break-words text-center font-black`} style={{ top: `${subtitleYPercent(settings.vertical_position)}%`, fontFamily: coverFontFamily(settings.font), fontSize: `${Math.max(10, 18.3 * scale)}px`, lineHeight: SUBTITLE_LINE_HEIGHT, color: settings.color, WebkitTextStroke: settings.stroke_enabled ? "1.2px #000" : "0 transparent", textShadow: settings.shadow_enabled ? "0 0.5px 1px rgba(0,0,0,.9)" : "none" }}><PreviewEffectText text={previewText} effect={settings.effect} /></div>}
      </div>
    </div>

    {settings.enabled && <div className="mt-3 space-y-2.5">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" data-testid="subtitle-font-picker" onClick={() => setFontOpen(true)} className="min-w-0 rounded-xl bg-slate-100 px-3 py-2.5 text-left"><span className="block text-[10px] text-[var(--text-muted)]">폰트</span><strong className="block truncate text-xs" style={{ fontFamily: selectedFont.family }}>{selectedFont.label}</strong></button>
        <label className="rounded-xl bg-slate-100 px-3 py-2"><span className="flex justify-between text-[10px] text-[var(--text-muted)]"><span>크기</span><b>{settings.size}px</b></span><input data-testid="subtitle-size" type="range" min="64" max="144" step="4" value={settings.size} onChange={(event) => update("size", Number(event.target.value))} className="mt-1 w-full accent-[var(--primary)]" /></label>
      </div>
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1" data-testid="subtitle-position">{(Object.keys(POSITION_LABELS) as SubtitleVerticalPosition[]).map((position) => <button type="button" key={position} aria-pressed={settings.vertical_position === position} onClick={() => update("vertical_position", position)} className={`rounded-lg py-2 text-xs font-semibold ${settings.vertical_position === position ? "bg-white text-[var(--primary)] shadow-sm" : "text-[var(--text-muted)]"}`}>{POSITION_LABELS[position]}</button>)}</div>
      <div className="grid grid-cols-[1fr_auto_auto] gap-2">
        <label className="flex min-w-0 items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold"><input data-testid="subtitle-color" type="color" value={settings.color} onChange={(event) => update("color", event.target.value)} className="h-6 w-6 border-0 bg-transparent p-0" />글자색</label>
        <button type="button" aria-pressed={settings.stroke_enabled} onClick={() => update("stroke_enabled", !settings.stroke_enabled)} className={`rounded-xl px-3 text-[11px] font-semibold ${settings.stroke_enabled ? "bg-indigo-50 text-[var(--primary)]" : "bg-slate-100 text-[var(--text-muted)]"}`}>외곽선 {settings.stroke_enabled ? "ON" : "OFF"}</button>
        <button type="button" aria-pressed={settings.shadow_enabled} onClick={() => update("shadow_enabled", !settings.shadow_enabled)} className={`rounded-xl px-3 text-[11px] font-semibold ${settings.shadow_enabled ? "bg-indigo-50 text-[var(--primary)]" : "bg-slate-100 text-[var(--text-muted)]"}`}>그림자 {settings.shadow_enabled ? "ON" : "OFF"}</button>
      </div>
      <label className="block rounded-xl bg-slate-100 px-3 py-2"><span className="mb-1 block text-[10px] text-[var(--text-muted)]">애니메이션 효과</span><select data-testid="subtitle-effect" value={settings.effect} onChange={(event) => update("effect", event.target.value as SubtitleEffect)} className="w-full bg-transparent text-sm font-semibold outline-none">{SUBTITLE_EFFECT_SPECS.map((effect) => <option key={effect.id} value={effect.id}>{effect.label}</option>)}</select></label>
    </div>}
    <button type="button" data-testid="save-subtitle-button" disabled={saving} onClick={async () => { await onSave(settings); onDirtyChange(false); }} className="mt-3 w-full rounded-xl bg-[var(--primary)] py-3 text-sm font-semibold text-white disabled:opacity-50">{saving ? "자막 저장 중…" : saved ? "자막 설정 적용" : "자막 설정 저장"}</button>
    {saved && <p className="mt-2 text-center text-[11px] text-[var(--success)]">{settings.enabled ? `${job.subtitle.segments.length}개 자막 segment 준비 완료` : "자막을 사용하지 않습니다."}</p>}
    {fontOpen && <FontSheet selected={settings.font} onSelect={(font) => update("font", font)} onClose={() => setFontOpen(false)} />}
  </section>;
}
