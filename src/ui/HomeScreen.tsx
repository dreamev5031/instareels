"use client";

import { useState } from "react";
import { Job, STAGE_ORDER, StageName } from "@/shared/types";
import { generateTts, runAnalysis, uploadVideos } from "./api";
import { DEFAULT_VOICE } from "@/tts/voices";
import TtsStep from "./components/TtsStep";
import UploadStep from "./components/UploadStep";
import ProgressView from "./components/ProgressView";
import ResultSummary from "./components/ResultSummary";
import FailureView from "./components/FailureView";

export default function HomeScreen() {
  const [job, setJob] = useState<Job | null>(null);
  const [ttsText, setTtsText] = useState("");
  const [voice, setVoice] = useState(DEFAULT_VOICE);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  const [ttsLoading, setTtsLoading] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  const failedStage: StageName | null =
    job ? STAGE_ORDER.find((s) => job.stages[s].status === "FAILED") ?? null : null;

  async function handleGenerateTts() {
    setTtsLoading(true);
    setRequestError(null);
    try {
      const updated = await generateTts(job?.job_id ?? null, ttsText, voice);
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
      const updated = await uploadVideos(job.job_id, files);
      setJob(updated);
    } catch (err) {
      setRequestError((err as Error).message);
    } finally {
      setUploadLoading(false);
    }
  }

  async function handleAnalyze() {
    if (!job) return;
    setAnalyzing(true);
    setRequestError(null);
    try {
      const finalJob = await runAnalysis(job.job_id, (snapshot) => setJob(snapshot));
      setJob(finalJob);
    } catch (err) {
      setRequestError((err as Error).message);
    } finally {
      setAnalyzing(false);
    }
  }

  function handleRetry() {
    if (!failedStage) return;
    if (failedStage === "TTS") {
      handleGenerateTts();
    } else if (failedStage === "UPLOAD") {
      handleUpload(selectedFiles);
    } else {
      handleAnalyze();
    }
  }

  const ttsDone = job?.stages.TTS.status === "SUCCESS";
  const uploadDone = job?.stages.UPLOAD.status === "SUCCESS";
  const showAnalyzeButton = uploadDone && !analyzing && job?.stages.VALIDATE.status !== "SUCCESS" && !failedStage;
  const pipelineStarted =
    analyzing ||
    (job && ["OCR", "CLIP", "ALLOCATE", "VALIDATE"].some((s) => job.stages[s as StageName].status !== "PENDING"));
  const showResult = job?.stages.VALIDATE.status === "SUCCESS";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col bg-[var(--bg)] pb-10">
      <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--surface)] px-5 py-4">
        <h1 className="text-lg font-bold tracking-tight">Instagram Reels Generator</h1>
        {job && <p className="mt-0.5 text-xs text-[var(--text-muted)]">{job.job_id}</p>}
      </header>

      <div className="flex flex-1 flex-col gap-4 px-4 pt-4">
        <TtsStep
          text={ttsText}
          onTextChange={setTtsText}
          voice={voice}
          onVoiceChange={setVoice}
          loading={ttsLoading}
          job={job}
          onGenerate={handleGenerateTts}
        />

        {ttsDone && (
          <UploadStep
            job={job!}
            loading={uploadLoading}
            onUpload={handleUpload}
            onAnalyze={handleAnalyze}
            showAnalyzeButton={!!showAnalyzeButton}
            analyzing={analyzing}
          />
        )}

        {requestError && (
          <div className="rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-bg)] px-4 py-3 text-sm text-[var(--danger)]">
            {requestError}
          </div>
        )}

        {pipelineStarted && job && <ProgressView job={job} />}

        {failedStage && job && <FailureView job={job} stage={failedStage} onRetry={handleRetry} retrying={ttsLoading || uploadLoading || analyzing} />}

        {showResult && job && <ResultSummary job={job} />}
      </div>
    </main>
  );
}
