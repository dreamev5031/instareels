import path from "node:path";

export const DATA_ROOT = process.env.DATA_ROOT || path.join(process.cwd(), "data");
export const JOBS_ROOT = path.join(DATA_ROOT, "jobs");

export function jobDir(jobId: string): string {
  return path.join(JOBS_ROOT, jobId);
}

export function jobFile(jobId: string): string {
  return path.join(jobDir(jobId), "job.json");
}

export function jobSourcesDir(jobId: string): string {
  return path.join(jobDir(jobId), "sources");
}

export function jobThumbsDir(jobId: string): string {
  return path.join(jobDir(jobId), "thumbs");
}

export function jobTtsDir(jobId: string): string {
  return path.join(jobDir(jobId), "tts");
}

export function jobFramesDir(jobId: string, sourceId: string): string {
  return path.join(jobDir(jobId), "frames", sourceId);
}
