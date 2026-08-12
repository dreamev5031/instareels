import { createWorker, PSM, Worker } from "tesseract.js";
import { OcrEngine, OcrEngineResult } from "./engine";

export class TesseractOcrEngine implements OcrEngine {
  private workerPromise: Promise<Worker> | null = null;

  private async createWorker(): Promise<Worker> {
    const worker = await createWorker("chi_sim+eng");
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
