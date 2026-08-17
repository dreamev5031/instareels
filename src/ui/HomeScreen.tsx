"use client";

import { useEffect, useRef, useState } from "react";
import { BgmSettings, Job, QueueKind, STAGE_ORDER, StageName, TtsProviderName } from "@/shared/types";
import {
  ApiRequestError,
  deleteUploadedSource,
  fetchJob,
  generateTts,
  pollJobUntilSettled,
  saveBgm,
  saveCover,
  saveSubtitle,
  startAnalysis,
  startRender,
  uploadVideos,
} from "./api";
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
import BackgroundNotice from "./components/BackgroundNotice";
import PushPermissionPrompt from "./components/PushPermissionPrompt";
import { notificationPermissionState } from "@/ui/push";

const CURRENT_JOB_KEY = "instareels.currentJobId";
const PUSH_PROMPT_SEEN_KEY = "instareels.pushPromptSeen";

function rememberJobId(jobId: string) {
  try {
    window.localStorage.setItem(CURRENT_JOB_KEY, jobId);
  } catch {
    // Private mode / storage full — resuming on next visit just won't work.
  }
}

export default function HomeScreen({ initialJobId }: { initialJobId?: string } = {}) {
  const [job, setJob] = useState<Job | null>(null);
  const [hydrating, setHydrating] = useState(true);
  const [ttsText, setTtsText] = useState("");
  const [ttsProvider, setTtsProvider] = useState<TtsProviderName>("elevenlabs");
  const [voice, setVoice] = useState("");
  const [voiceLabel, setVoiceLabel] = useState("");
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
  const [showPushPrompt, setShowPushPrompt] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function setKindLoading(kind: QueueKind, value: boolean) {
    if (kind === "tts") setTtsLoading(value);
    else if (kind === "analyze") setAnalyzing(value);
    else setRendering(value);
  }

  function adoptJob(next: Job) {
    if (!mountedRef.current) return;
    setJob(next);
    rememberJobId(next.job_id);
    if (next.queue && notificationPermissionState() === "default") {
      const seen = typeof window !== "undefined" && window.localStorage.getItem(PUSH_PROMPT_SEEN_KEY);
      if (!seen) setShowPushPrompt(true);
    }
  }

  async function trackUntilSettled(kind: QueueKind, initial: Job) {
    adoptJob(initial);
    setKindLoading(kind, true);
    try {
      const settled = await pollJobUntilSettled(initial.job_id, adoptJob);
      adoptJob(settled);
    } finally {
      if (mountedRef.current) setKindLoading(kind, false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const targetId = initialJobId ?? (typeof window !== "undefined" ? window.localStorage.getItem(CURRENT_JOB_KEY) : null);
      if (!targetId) {
        setHydrating(false);
        return;
      }
      try {
        const resumed = await fetchJob(targetId);
        if (cancelled) return;
        adoptJob(resumed);
        if (resumed.queue?.status === "QUEUED" || resumed.queue?.status === "RUNNING") {
          setHydrating(false);
          await trackUntilSettled(resumed.queue.kind, resumed);
          return;
        }
      } catch {
        try {
          window.localStorage.removeItem(CURRENT_JOB_KEY);
        } catch {
          // Ignore stale local storage cleanup failures.
        }
      }
      if (!cancelled) setHydrating(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJobId]);

  const failedStage: StageName | null = job
    ? STAGE_ORDER.find((stage) => stage !== "COVER" && job.stages[stage].status === "FAILED") ?? null
    : null;

  async function handleGenerateTts() {
    const config = { provider: ttsProvider, voiceId: voice, voiceAlias: voiceLabel, text: ttsText };
    if (!config.voiceId) {
      setRequestError(config.provider === "elevenlabs" ? "ElevenLabs 목소리를 선택해 주세요." : "목소리를 선택해 주세요.");
      return;
    }
    if (job?.queue?.kind === "tts" && (job.queue.status === "QUEUED" || job.queue.status === "RUNNING")) return;
    setRequestError(null);
    try {
      const queued = await generateTts(job?.job_id ?? null, config);
      await trackUntilSettled("tts", queued);
    } catch (err) {
      if (mountedRef.current) setRequestError((err as Error).message);
    }
  }

  async function handleUpload(files: File[]) {
    if (!job) return;
    setSelectedFiles(files);
    setUploadLoading(true);
    setRequestError(null);
    try {
      const updated = await uploadVideos(job.job_id, files, ocrEnabled);
      adoptJob(updated);
    } catch (err) {
      if (err instanceof ApiRequestError && err.job) adoptJob(err.job);
      setRequestError((err as Error).message);
    } finally {
      setUploadLoading(false);
    }
  }

  async function handleDeleteSource(sourceId: string) {
    if (!job) return;
    setRequestError(null);
    try {
      const updated = await deleteUploadedSource(job.job_id, sourceId);
      adoptJob(updated);
    } catch (err) {
      if (err instanceof ApiRequestError && err.job) adoptJob(err.job);
      setRequestError((err as Error).message);
      throw err;
    }
  }

  async function handleCoverSave(file: File | null, settings: Omit<CoverSettings, "image">) {
    if (!job) return;
    setCoverSaving(true);
    setRequestError(null);
    try {
      const updated = await saveCover(job.job_id, file, settings);
      adoptJob(updated);
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
    if (job.queue?.kind === "analyze" && (job.queue.status === "QUEUED" || job.queue.status === "RUNNING")) return;
    setRequestError(null);
    try {
      const queued = await startAnalysis(job.job_id, ocrEnabled);
      await trackUntilSettled("analyze", queued);
    } catch (err) {
      if (mountedRef.current) setRequestError((err as Error).message);
    }
  }

  async function handleRender() {
    if (!job) return;
    if (job.queue?.kind === "render" && (job.queue.status === "QUEUED" || job.queue.status === "RUNNING")) return;
    setRequestError(null);
    try {
      const queued = await startRender(job.job_id);
      await trackUntilSettled("render", queued);
    } catch (err) {
      if (mountedRef.current) setRequestError((err as Error).message);
    }
  }

  async function handleSubtitleSave(settings: SubtitleSettings) {
    if (!job) return;
    setSubtitleSaving(true);
    setRequestError(null);
    try {
      const updated = await saveSubtitle(job.job_id, settings);
      adoptJob(updated);
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
      adoptJob(updated);
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
    if (failedStage === "TTS") handleGenerateTts();
    else if (failedStage === "UPLOAD") handleUpload(selectedFiles);
    else if (failedStage === "RENDER") handleRender();
    else handleAnalyze();
  }

  const ttsDone = job?.stages.TTS.status === "SUCCESS";
  const coverDone = job?.stages.COVER.status === "SUCCESS";
  const uploadDone = job?.stages.UPLOAD.status === "SUCCESS";
  const hasSources = Boolean(job?.sources.length);
  const showAnalyzeButton = Boolean(ttsDone && uploadDone && hasSources && coverDone && !coverDirty && !analyzing && job?.stages.VALIDATE.status !== "SUCCESS" && !failedStage);
  const pipelineStarted = analyzing || (job && ["OCR", "CLIP", "ALLOCATE", "VALIDATE", "RENDER"].some((s) => job.stages[s as StageName].status !== "PENDING"));
  const showResult = job?.stages.VALIDATE.status === "SUCCESS";
  const backgroundActive = job?.queue?.status === "QUEUED" || job?.queue?.status === "RUNNING";

  function dismissPushPrompt() {
    setShowPushPrompt(false);
    try {
      window.localStorage.setItem(PUSH_PROMPT_SEEN_KEY, "1");
    } catch {
      // Best effort.
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col bg-[var(--bg)] pb-10">
      <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--surface)] px-5 py-4">
        <h1 className="text-lg font-bold tracking-tight">Instagram Reels Generator</h1>
        {job && <p className="mt-0.5 text-xs text-[var(--text-muted)]">{job.job_id}</p>}
        <WorkflowSteps job={job} />
      </header>

      <div className="flex flex-1 flex-col gap-4 px-4 pt-4">
        {hydrating && <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-center text-sm text-[var(--text-muted)]">이전 작업을 불러오는 중...</div>}

        {!hydrating && (
          <>
            <TtsStep
              text={ttsText}
              onTextChange={setTtsText}
              provider={ttsProvider}
              onProviderChange={setTtsProvider}
              voice={voice}
              voiceLabel={voiceLabel}
              onVoiceChange={(v, label) => { setVoice(v); setVoiceLabel(label); }}
              loading={ttsLoading}
              job={job}
              onGenerate={handleGenerateTts}
            />

            {ttsDone && <CoverStep job={job!} saving={coverSaving} onSave={handleCoverSave} onDirtyChange={setCoverDirty} />}

            <UploadStep
              job={job}
              loading={uploadLoading}
              onUpload={handleUpload}
              onDeleteSource={handleDeleteSource}
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

            {requestError && <div className="rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-bg)] px-4 py-3 text-sm text-[var(--danger)]">{requestError}</div>}
            {backgroundActive && <BackgroundNotice />}
            {showPushPrompt && <PushPermissionPrompt onDismiss={dismissPushPrompt} />}
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
          </>
        )}
      </div>
    </main>
  );
}
