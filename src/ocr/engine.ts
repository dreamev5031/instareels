export interface OcrEngineResult {
  rawText: string;
  confidence: number;
}

export interface OcrEngine {
  recognize(imagePath: string): Promise<OcrEngineResult>;
  dispose(): Promise<void>;
}
