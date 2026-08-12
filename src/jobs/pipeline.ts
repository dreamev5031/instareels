import { Job } from "@/shared/types";
import { runOcrStage } from "@/ocr";
import { runClipStage } from "@/clips";
import { runAllocateStage } from "@/allocator";
import { runValidateStage } from "@/validator";
import { saveJob } from "./store";

export type PipelineProgressCallback = (job: Job) => void;

/**
 * Runs OCR -> CLIP -> ALLOCATE -> VALIDATE in order, persisting job state after
 * every stage (success or failure) so a mid-pipeline failure is fully visible
 * in the saved JOB data. Stops at the first stage that throws.
 */
export async function runAnalysisPipeline(job: Job, onProgress?: PipelineProgressCallback): Promise<void> {
  try {
    await runOcrStage(job, onProgress);
  } finally {
    saveJob(job);
    onProgress?.(job);
  }

  try {
    runClipStage(job);
  } finally {
    saveJob(job);
    onProgress?.(job);
  }

  try {
    runAllocateStage(job);
  } finally {
    saveJob(job);
    onProgress?.(job);
  }

  try {
    runValidateStage(job);
  } finally {
    saveJob(job);
    onProgress?.(job);
  }
}
