export type StageName =
  | "TTS"
  | "UPLOAD"
  | "OCR"
  | "CLIP"
  | "ALLOCATE"
  | "VALIDATE";

export const STAGE_ORDER: StageName[] = [
  "TTS",
  "UPLOAD",
  "OCR",
  "CLIP",
  "ALLOCATE",
  "VALIDATE",
];

export type StageStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";

export type ErrorCode =
  | "TTS_EMPTY_TEXT"
  | "TTS_GENERATION_FAILED"
  | "TTS_PROBE_FAILED"
  | "UPLOAD_NO_FILES"
  | "UPLOAD_PROBE_FAILED"
  | "UPLOAD_UNSUPPORTED_FORMAT"
  | "OCR_ENGINE_FAILED"
  | "OCR_NO_SOURCES"
  | "NO_SAFE_SEGMENTS"
  | "CLIP_GENERATION_FAILED"
  | "NO_AVAILABLE_CLIP"
  | "INSUFFICIENT_TOTAL_DURATION"
  | "SOURCE_OVERUSE"
  | "DUPLICATE_CLIP"
  | "DUPLICATE_RANGE"
  | "OCR_BLOCKED_USED"
  | "EMPTY_TIMELINE_GAP"
  | "CONSECUTIVE_SOURCE_LIMIT"
  | "SCENE_ID_SEQUENCE"
  | "DURATION_MISMATCH";

export interface JobError {
  stage: StageName;
  error_code: ErrorCode;
  message: string;
  source_id?: string;
  clip_id?: string;
  scene_id?: string;
  context?: Record<string, unknown>;
  timestamp: string;
}

export interface JobLogEntry {
  timestamp: string;
  stage: StageName;
  level: "info" | "warn" | "error";
  message: string;
  context?: Record<string, unknown>;
}

export interface StageState {
  status: StageStatus;
  startedAt?: string;
  finishedAt?: string;
  error?: JobError;
}

export type Voice = {
  shortName: string;
  locale: string;
  gender: string;
  friendlyName: string;
};

export interface TtsResult {
  status: "success" | "failed";
  text: string;
  voice: string;
  file: string;
  duration: number;
}

export type SourceStatus = "PENDING" | "ANALYZING" | "ANALYZED" | "FAILED";

export interface SourceVideo {
  source_id: string;
  original_filename: string;
  file: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  status: SourceStatus;
  thumbnail?: string;
}

export type OcrBlockReason = "CHINESE_TEXT_DETECTED" | "TEXT_DETECTED";

export interface OcrSegment {
  start: number;
  end: number;
  ocr_safe: boolean;
  reason?: OcrBlockReason;
  sample_text?: string;
  /** Average tesseract confidence (0-100) across the frames in this segment.
   *  Low confidence on a BLOCKED segment is a strong signal the detection may
   *  be a false positive worth reviewing manually. */
  confidence?: number;
}

export interface OcrSourceResult {
  source_id: string;
  segments: OcrSegment[];
}

export interface Clip {
  clip_id: string;
  source_id: string;
  source_start: number;
  source_end: number;
  duration: number;
  ocr_safe: true;
  used: boolean;
}

export interface Scene {
  scene_id: string;
  timeline_start: number;
  timeline_end: number;
  duration: number;
  source_id: string;
  clip_id: string;
  source_start: number;
  source_end: number;
}

export interface AllocationCandidateBreakdown {
  total_clips_on_sources: number;
  ocr_blocked: number;
  already_used: number;
  same_source_policy: number;
  too_short: number;
  available: number;
}

export interface AllocationDecision {
  scene_id: string;
  selected_source_id: string;
  selected_clip_id: string;
  selected_clip_duration: number;
  allocated_duration: number;
  remaining_before: number;
  source_used_duration_before: number;
  source_used_duration_after: number;
  source_scene_count_before: number;
  previous_source_id: string | null;
  candidate_count: number;
  eligible_candidate_count: number;
  selection_policy: "FIRST_SCENE_BALANCE" | "AVOID_PREVIOUS_SOURCE" | "ONLY_AVAILABLE_SOURCE";
}

export interface ValidationCheck {
  code: ErrorCode;
  passed: boolean;
  message: string;
  detail?: Record<string, unknown>;
}

export interface ValidationResult {
  status: "PASS" | "FAIL";
  checks: ValidationCheck[];
  source_usage: Record<string, { total_duration: number; ratio: number; scene_count: number }>;
  total_scene_duration: number;
  tts_duration: number;
  scene_count: number;
  source_count_used: number;
  source_count_total: number;
}

export interface Job {
  job_id: string;
  created_at: string;
  updated_at: string;
  stages: Record<StageName, StageState>;
  tts?: TtsResult;
  sources: SourceVideo[];
  ocr: Record<string, OcrSegment[]>;
  clips: Clip[];
  scenes: Scene[];
  allocation_decisions?: AllocationDecision[];
  validation?: ValidationResult;
  logs: JobLogEntry[];
}

export class PipelineError extends Error {
  code: ErrorCode;
  stage: StageName;
  context?: Record<string, unknown>;
  source_id?: string;
  clip_id?: string;
  scene_id?: string;

  constructor(
    stage: StageName,
    code: ErrorCode,
    message: string,
    extra?: {
      context?: Record<string, unknown>;
      source_id?: string;
      clip_id?: string;
      scene_id?: string;
    }
  ) {
    super(message);
    this.name = "PipelineError";
    this.stage = stage;
    this.code = code;
    this.context = extra?.context;
    this.source_id = extra?.source_id;
    this.clip_id = extra?.clip_id;
    this.scene_id = extra?.scene_id;
  }
}
