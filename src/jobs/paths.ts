import path from "node:path";

export const WORK_DIR = process.env.WORK_DIR || path.join(process.cwd(), "data");
export const JOBS_ROOT = path.join(WORK_DIR, "jobs");

/** Where tesseract.js caches downloaded language trained-data files.
 *  Without this, it defaults to `process.cwd()`, which may not be writable
 *  in a container (and pollutes the app directory even when it is). */
export const OCR_CACHE_DIR = path.join(WORK_DIR, "ocr-cache");

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

export function jobCoverDir(jobId: string): string {
  return path.join(jobDir(jobId), "cover");
}

export function jobFramesDir(jobId: string, sourceId: string): string {
  return path.join(jobDir(jobId), "frames", sourceId);
}
