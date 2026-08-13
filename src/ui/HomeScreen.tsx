"use client";

import { useState } from "react";
import { BgmSettings, Job, STAGE_ORDER, StageName, TtsProviderName } from "@/shared/types";
import { ApiRequestError, generateTts, renderVideo, runAnalysis, saveBgm, saveCover, saveSubtitle, uploadVideos } from "./api";
import { DEFAULT_VOICE, SUPPORTED_VOICES } from "@/tts/voices";
import TtsStep from "./components/TtsStep";
import UploadStep from "./components/UploadStep";
import ProgressView from "./components/ProgressView";
import ResultSummary from "./components/ResultSummary";
import FailureView from "./components/FailureView";
import CoverStep from "./components/CoverStep";
import WorkflowSteps from "./components/WorkflowSteps";
import type { CoverSettings } from "@/shared/types";
import RenderPanel from "./components/RenderPanel";
import SubtitleStep from "./components/SubtitleStep";
import type { SubtitleSettings } from "@/shared/types";
import BgmStep from "./components/BgmStep";

export default function HomeScreen() {
  const [job, setJob] = useState<Job | null>(null);
  const [ttsText, setTtsText] = useState("");
  const [ttsProvider, setTtsProvider] = useState<TtsProviderName>("edge");
  const [voice, setVoice] = useState(DEFAULT_VOICE);
  const [voiceLabel, setVoiceLabel] = useState(
    SUPPORTED_VOICES.find((v) => v.shortName === DEFAULT_VOICE)?.friendlyName ?? DEFAULT_VOICE
  );
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  const [ttsLoading, setTtsLoading] = useState(false);
  const [coverSaving, setCoverSaving] = useState(false);
  const [coverDirty, setCoverDirty] = useState(false);
  const [ocrEnabled, setOcrEnabled] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [subtitleSaving, setSubtitleSaving] = useState(false);
  const [subtitleDirty, setSubtitleDirty] = useState(false);
  const [bgmSaving, setBgmSaving] = useState(false);
  const [bgmDirty, setBgmDirty] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  const failedStage: StageName | null = job
    ? STAGE_ORDER.find((stage) => stage !== "COVER" && job.stages[stage].status === "FAILED") ?? null
    : null;

  async function handleGenerateTts() {
    setTtsLoading(true);
    setRequestError(null);
    try {
      const updated = await generateTts(job?.job_id ?? null, ttsText, voice, ttsProvider);
      setJob(updated);
    } catch (err) {
      setRequestError((err as Error).message);
    } finally {
      setTtsLoading(false);
    }
  }

  async function handleUpload(files: File[]) {
    if (!job) return;
    setSelectedFiles(files);
    setUploadLoading(true);
    setRequestError(null);
    try {
      const updated = await uploadVideos(job.job_id, files, ocrEnabled);
      setJob(updated);
    } catch (err) {
      if (err instanceof ApiRequestError && err.job) setJob(err.job);
      setRequestError((err as Error).message);
    } finally {
      setUploadLoading(false);
    }
  }

  async function handleCoverSave(file: File | null, settings: Omit<CoverSettings, "image">) {
    if (!job) return;
    setCoverSaving(true);
    setRequestError(null);
    try {
      const updated = await saveCover(job.job_id, file, settings);
      setJob(updated);
      if (updated.stages.COVER.status !== "SUCCESS") {
        throw new Error(updated.stages.COVER.error?.message ?? "앞표지를 저장하지 못했습니다.");
      }
      setCoverDirty(false);
    } finally {
      setCoverSaving(false);
    }
  }

  async function handleAnalyze() {
    if (!job) return;
    setAnalyzing(true);
    setRequestError(null);
    try {
      const finalJob = await runAnalysis(job.job_id, ocrEnabled, (snapshot) => setJob(snapshot));
      setJob(finalJob);
    } catch (err) {
      setRequestError((err as Error).message);
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleRender() {
    if (!job) return;
    setRendering(true);
    setRequestError(null);
    try {
      const rendered = await renderVideo(job.job_id, (snapshot) => setJob(snapshot));
      setJob(rendered);
    } catch (err) {
      setRequestError((err as Error).message);
    } finally {
      setRendering(false);
    }
  }

  async function handleSubtitleSave(settings: SubtitleSettings) {
    if (!job) return;
    setSubtitleSaving(true);
    setRequestError(null);
    try {
      const updated = await saveSubtitle(job.job_id, settings);
      setJob(updated);
      setSubtitleDirty(false);
    } catch (err) {
      setRequestError((err as Error).message);
      throw err;
    } finally {
      setSubtitleSaving(false);
    }
  }

  async function handleBgmSave(settings: BgmSettings) {
    if (!job) return;
    setBgmSaving(true);
    setRequestError(null);
    try {
      const updated = await saveBgm(job.job_id, settings);
      setJob(updated);
      setBgmDirty(false);
    } catch (err) {
      setRequestError((err as Error).message);
      throw err;
    } finally {
      setBgmSaving(false);
    }
  }

  function handleRetry() {
    if (!failedStage) return;
    if (failedStage === "TTS") {
      handleGenerateTts();
    } else if (failedStage === "UPLOAD") {
      handleUpload(selectedFiles);
    } else if (failedStage === "RENDER") {
      handleRender();
    } else {
      handleAnalyze();
    }
  }

  const ttsDone = job?.stages.TTS.status === "SUCCESS";
  const coverDone = job?.stages.COVER.status === "SUCCESS";
  const uploadDone = job?.stages.UPLOAD.status === "SUCCESS";
  const showAnalyzeButton = Boolean(ttsDone && uploadDone && coverDone && !coverDirty && !analyzing && job?.stages.VALIDATE.status !== "SUCCESS" && !failedStage);
  const pipelineStarted =
    analyzing ||
    (job && ["OCR", "CLIP", "ALLOCATE", "VALIDATE", "RENDER"].some((s) => job.stages[s as StageName].status !== "PENDING"));
  const showResult = job?.stages.VALIDATE.status === "SUCCESS";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col bg-[var(--bg)] pb-10">
      <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--surface)] px-5 py-4">
        <h1 className="text-lg font-bold tracking-tight">Instagram Reels Generator</h1>
        {job && <p className="mt-0.5 text-xs text-[var(--text-muted)]">{job.job_id}</p>}
        <WorkflowSteps job={job} />
      </header>

      <div className="flex flex-1 flex-col gap-4 px-4 pt-4">
        <TtsStep
          text={ttsText}
          onTextChange={setTtsText}
          provider={ttsProvider}
          onProviderChange={setTtsProvider}
          voice={voice}
          voiceLabel={voiceLabel}
          onVoiceChange={(v, label) => {
            setVoice(v);
            setVoiceLabel(label);
          }}
          loading={ttsLoading}
          job={job}
          onGenerate={handleGenerateTts}
        />

        {ttsDone && (
          <CoverStep
            job={job!}
            saving={coverSaving}
            onSave={handleCoverSave}
            onDirtyChange={setCoverDirty}
          />
        )}

        <UploadStep
          job={job}
          loading={uploadLoading}
          onUpload={handleUpload}
          onAnalyze={handleAnalyze}
          canUpload={Boolean(ttsDone && coverDone && !coverDirty)}
          canAnalyze={showAnalyzeButton}
          analyzing={analyzing}
          analysisComplete={Boolean(showResult)}
          ttsReady={Boolean(ttsDone)}
          coverReady={Boolean(coverDone && !coverDirty)}
          ocrEnabled={ocrEnabled}
          onOcrEnabledChange={setOcrEnabled}
          ocrLocked={analyzing || Boolean(showResult)}
        />

        {requestError && (
          <div className="rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-bg)] px-4 py-3 text-sm text-[var(--danger)]">
            {requestError}
          </div>
        )}

        {pipelineStarted && job && <ProgressView job={job} />}

        {failedStage && job && <FailureView job={job} stage={failedStage} onRetry={handleRetry} retrying={ttsLoading || coverSaving || uploadLoading || analyzing || rendering} />}

        {showResult && job && (
          <>
            <ResultSummary job={job} />
            <SubtitleStep job={job} saving={subtitleSaving} onSave={handleSubtitleSave} onDirtyChange={setSubtitleDirty} />
            <BgmStep job={job} saving={bgmSaving} onSave={handleBgmSave} onDirtyChange={setBgmDirty} />
            <RenderPanel job={job} rendering={rendering} onRender={handleRender} subtitleReady={job.subtitle.status === "SUCCESS" && !subtitleDirty && !bgmDirty} />
          </>
        )}
      </div>
    </main>
  );
}
