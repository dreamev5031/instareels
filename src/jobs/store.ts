import fs from "node:fs";
import path from "node:path";
import {
  Job,
  JobError,
  JobLogEntry,
  createDefaultCoverSettings,
  STAGE_ORDER,
  StageName,
  StageStatus,
} from "@/shared/types";
import { JOBS_ROOT, jobCoverDir, jobDir, jobFile, jobSourcesDir, jobThumbsDir, jobTtsDir } from "./paths";

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function nextJobId(): string {
  ensureDir(JOBS_ROOT);
  const existing = fs
    .readdirSync(JOBS_ROOT)
    .filter((name) => /^JOB_\d{6}$/.test(name))
    .map((name) => parseInt(name.slice(4), 10));
  const next = existing.length > 0 ? Math.max(...existing) + 1 : 1;
  return `JOB_${String(next).padStart(6, "0")}`;
}

export function createJob(): Job {
  const jobId = nextJobId();
  ensureDir(jobDir(jobId));
  ensureDir(jobSourcesDir(jobId));
  ensureDir(jobThumbsDir(jobId));
  ensureDir(jobTtsDir(jobId));
  ensureDir(jobCoverDir(jobId));

  const now = new Date().toISOString();
  const stages = Object.fromEntries(
    STAGE_ORDER.map((s) => [s, { status: "PENDING" as StageStatus }])
  ) as Job["stages"];

  const job: Job = {
    job_id: jobId,
    created_at: now,
    updated_at: now,
    stages,
    cover: createDefaultCoverSettings(),
    sources: [],
    ocr: {},
    clips: [],
    scenes: [],
    logs: [],
  };

  saveJob(job);
  return job;
}

export function loadJob(jobId: string): Job {
  const raw = fs.readFileSync(jobFile(jobId), "utf-8");
  const job = JSON.parse(raw) as Job;
  if (!job.stages.COVER) {
    job.stages = {
      TTS: job.stages.TTS,
      COVER: { status: "PENDING" },
      UPLOAD: job.stages.UPLOAD,
      OCR: job.stages.OCR,
      CLIP: job.stages.CLIP,
      ALLOCATE: job.stages.ALLOCATE,
      VALIDATE: job.stages.VALIDATE,
    };
  }
  job.cover ??= createDefaultCoverSettings();
  ensureDir(jobCoverDir(jobId));
  return job;
}

export function jobExists(jobId: string): boolean {
  return fs.existsSync(jobFile(jobId));
}

export function saveJob(job: Job): void {
  job.updated_at = new Date().toISOString();
  ensureDir(jobDir(job.job_id));
  fs.writeFileSync(jobFile(job.job_id), JSON.stringify(job, null, 2), "utf-8");
}

export function listJobs(): Job[] {
  ensureDir(JOBS_ROOT);
  return fs
    .readdirSync(JOBS_ROOT)
    .filter((name) => /^JOB_\d{6}$/.test(name))
    .map((name) => loadJob(name))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export function addLog(
  job: Job,
  stage: StageName,
  level: JobLogEntry["level"],
  message: string,
  context?: Record<string, unknown>
): void {
  job.logs.push({
    timestamp: new Date().toISOString(),
    stage,
    level,
    message,
    context,
  });
}

export function startStage(job: Job, stage: StageName): void {
  job.stages[stage] = {
    status: "RUNNING",
    startedAt: new Date().toISOString(),
  };
  addLog(job, stage, "info", `${stage} 단계 시작`);
}

export function succeedStage(job: Job, stage: StageName): void {
  const prev = job.stages[stage];
  job.stages[stage] = {
    status: "SUCCESS",
    startedAt: prev?.startedAt,
    finishedAt: new Date().toISOString(),
  };
  addLog(job, stage, "info", `${stage} 단계 성공`);
}

export function failStage(job: Job, stage: StageName, error: JobError): void {
  const prev = job.stages[stage];
  job.stages[stage] = {
    status: "FAILED",
    startedAt: prev?.startedAt,
    finishedAt: new Date().toISOString(),
    error,
  };
  addLog(job, stage, "error", error.message, {
    error_code: error.error_code,
    source_id: error.source_id,
    clip_id: error.clip_id,
    scene_id: error.scene_id,
    ...error.context,
  });
}

export function resetDownstreamStages(job: Job, fromStage: StageName): void {
  const idx = STAGE_ORDER.indexOf(fromStage);
  for (const stage of STAGE_ORDER.slice(idx)) {
    job.stages[stage] = { status: "PENDING" };
  }
}
