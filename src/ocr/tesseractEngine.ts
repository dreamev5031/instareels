import fs from "node:fs";
import { createWorker, PSM, Worker } from "tesseract.js";
import { OCR_CACHE_DIR } from "@/jobs/paths";
import { OcrEngine, OcrEngineResult } from "./engine";

export class TesseractOcrEngine implements OcrEngine {
  private workerPromise: Promise<Worker> | null = null;

  private async createWorker(): Promise<Worker> {
    // Without an explicit cachePath, tesseract.js defaults to `process.cwd()`
    // for downloaded language trained-data, which may not be writable in a
    // container and pollutes the app directory even when it is.
    fs.mkdirSync(OCR_CACHE_DIR, { recursive: true });
    // Keep English first. With the current tesseract.js/core combination,
    // `chi_sim+eng` initializes only the fallback language and prints a
    // traineddata load error, while `eng+chi_sim` loads both models cleanly.
    const worker = await createWorker("eng+chi_sim", undefined, { cachePath: OCR_CACHE_DIR });
    // Without an explicit PSM, tesseract.js falls back to a mode that
    // aggressively hunts for text everywhere in the frame, which hallucinates
    // CJK-looking glyphs out of ordinary photo texture/noise (verified against
    // real product-demo footage with no on-screen text at all). PSM.AUTO does
    // real page/text-region analysis first, so frames with no text region
    // come back empty instead of full of false positives, while genuine
    // burned-in captions are still recognized correctly.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
    return worker;
  }

  private getWorker(): Promise<Worker> {
    if (!this.workerPromise) {
      this.workerPromise = this.createWorker();
    }
    return this.workerPromise;
  }

  async recognize(imagePath: string): Promise<OcrEngineResult> {
    const worker = await this.getWorker();
    const { data } = await worker.recognize(imagePath);
    return { rawText: data.text ?? "", confidence: data.confidence ?? 0 };
  }

  async dispose(): Promise<void> {
    if (this.workerPromise) {
      const worker = await this.workerPromise;
      await worker.terminate();
      this.workerPromise = null;
    }
  }
}
