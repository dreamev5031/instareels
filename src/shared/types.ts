export type StageName =
  | "TTS"
  | "COVER"
  | "UPLOAD"
  | "OCR"
  | "CLIP"
  | "ALLOCATE"
  | "VALIDATE"
  | "RENDER";

export const STAGE_ORDER: StageName[] = [
  "TTS",
  "COVER",
  "UPLOAD",
  "OCR",
  "CLIP",
  "ALLOCATE",
  "VALIDATE",
  "RENDER",
];

export type StageStatus = "PENDING" | "RUNNING" | "SUCCESS" | "SKIPPED" | "FAILED";

export type ErrorCode =
  | "TTS_REQUIRED"
  | "TTS_EMPTY_TEXT"
  | "TTS_GENERATION_FAILED"
  | "TTS_PROBE_FAILED"
  | "COVER_IMAGE_REQUIRED"
  | "COVER_IMAGE_TOO_LARGE"
  | "COVER_UNSUPPORTED_FORMAT"
  | "COVER_INVALID_SETTINGS"
  | "COVER_SAVE_FAILED"
  | "UPLOAD_NO_FILES"
  | "UPLOAD_TOO_LARGE"
  | "FORMDATA_PARSE_FAILED"
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
  | "DURATION_MISMATCH"
  | "RENDER_VALIDATE_REQUIRED"
  | "RENDER_ALREADY_RUNNING"
  | "RENDER_PLAN_INVALID"
  | "SUBTITLE_INVALID_SETTINGS"
  | "SUBTITLE_TIMING_FAILED"
  | "SUBTITLE_FONT_NOT_FOUND"
  | "SUBTITLE_ASS_GENERATION_FAILED"
  | "SUBTITLE_BURN_FAILED"
  | "RENDER_SOURCE_MISSING"
  | "SOURCE_DECODE_FAILED"
  | "VIDEO_ASSEMBLY_FAILED"
  | "FONT_PREPARE_FAILED"
  | "COVER_RENDER_FAILED"
  | "AD_OVERLAY_FAILED"
  | "FINAL_CONCAT_FAILED"
  | "RENDER_OUTPUT_INVALID"
  | "RENDER_DECODE_FAILED"
  | "ELEVENLABS_NOT_CONFIGURED"
  | "ELEVENLABS_API_ERROR"
  | "ELEVENLABS_QUOTA_EXCEEDED"
  | "VOICE_NOT_FOUND"
  | "INVALID_VOICE_ID"
  | "VOICE_ALIAS_REQUIRED"
  | "VOICE_ID_REQUIRED"
  | "VOICE_REGISTRY_UNAVAILABLE"
  | "TIMESTAMP_MISSING"
  | "TIMESTAMP_PARSE_FAILED"
  | "TTS_PROVIDER_VOICE_MISMATCH"
  | "ELEVENLABS_VOICE_REQUIRED"
  | "JOB_ALREADY_QUEUED"
  | "QUEUE_UNAVAILABLE"
  | "PUSH_SUBSCRIPTION_REQUIRED"
  | "PUSH_NOT_CONFIGURED";

export const COVER_FONT_KEYS = [
  "nanum-square-round",
  "pretendard",
  "noto-sans-kr",
  "gmarket-sans",
  "tmoney-round-wind",
  "bm-dohyeon",
  "bm-hanna",
  "bm-jua",
  "score-dream-extrabold",
  "cafe24-dangdanghae",
  "yg-jalnan",
] as const;

export type CoverFontKey = (typeof COVER_FONT_KEYS)[number];
export type CoverVerticalPosition = "top" | "middle" | "bottom";

export interface CoverImageInfo {
  file: string;
  original_filename: string;
  mime_type: string;
  size: number;
}

export interface CoverSettings {
  image?: CoverImageInfo;
  main_text: string;
  sub_text: string;
  main_font: CoverFontKey;
  sub_font: CoverFontKey;
  use_same_font: boolean;
  vertical_position: CoverVerticalPosition;
  text_color: string;
  shadow_enabled: boolean;
  stroke_enabled: boolean;
}

export function createDefaultCoverSettings(): CoverSettings {
  return {
    main_text: "",
    sub_text: "",
    main_font: "score-dream-extrabold",
    sub_font: "score-dream-extrabold",
    use_same_font: true,
    vertical_position: "top",
    text_color: "#ffffff",
    shadow_enabled: true,
    stroke_enabled: true,
  };
}

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
  skipReason?: "DISABLED_BY_USER";
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
  provider: TtsProviderName;
  text: string;
  voice: string;
  voice_alias?: string;
  file: string;
  audio_path: string;
  duration: number;
  timing: TtsTimingData;
}

export type TtsProviderName = "edge" | "elevenlabs";

export interface TtsWordTiming {
  text: string;
  start: number;
  end: number;
  text_start?: number;
  text_end?: number;
}

export interface TtsTimingData {
  source: "provider_word" | "provider_segment" | "duration_fallback";
  words: TtsWordTiming[];
}

export const SUBTITLE_EFFECTS = [
  "typewriter",
  "rushed_typing",
  "copybook",
  "flat_popout",
  "word_zoom",
  "breeze",
  "transparent_gradient",
  "pink_blink",
  "easy_slide",
] as const;

export type SubtitleEffect = (typeof SUBTITLE_EFFECTS)[number];
export type SubtitleVerticalPosition = "top" | "middle" | "bottom";

export interface SubtitleSettings {
  enabled: boolean;
  font: CoverFontKey;
  size: number;
  color: string;
  stroke_enabled: boolean;
  shadow_enabled: boolean;
  vertical_position: SubtitleVerticalPosition;
  effect: SubtitleEffect;
}

export interface SubtitleSegment {
  segment_id: string;
  text: string;
  start: number;
  end: number;
  word_timings: TtsWordTiming[];
}

export interface SubtitleResult {
  status: "PENDING" | "SUCCESS" | "FAILED";
  settings: SubtitleSettings;
  segments: SubtitleSegment[];
  timing_source?: TtsTimingData["source"];
  ass_file?: string;
  burned_file?: string;
  event_count?: number;
  burn_verified?: boolean;
  error?: JobError;
}

export function createDefaultSubtitleSettings(): SubtitleSettings {
  return {
    enabled: true,
    font: "pretendard",
    size: 104,
    color: "#ffffff",
    stroke_enabled: true,
    shadow_enabled: true,
    vertical_position: "bottom",
    effect: "typewriter",
  };
}

export interface BgmSettings {
  bgmEnabled: boolean;
  bgmId?: string;
  bgmName?: string;
  bgmVolume: number;
}

export function createDefaultBgmSettings(): BgmSettings {
  return {
    bgmEnabled: false,
    bgmVolume: 0.18,
  };
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
  codec_name?: string;
  container_format?: string;
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
  skipped?: boolean;
  skip_reason?: "DISABLED_BY_USER";
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

export type RenderSubstageName =
  | "VIDEO_ASSEMBLY"
  | "SUBTITLE_GENERATION"
  | "SUBTITLE_BURN"
  | "AD_OVERLAY"
  | "COVER_RENDER"
  | "FINAL_CONCAT"
  | "OUTPUT_VALIDATE";

export const RENDER_SUBSTAGE_ORDER: RenderSubstageName[] = [
  "VIDEO_ASSEMBLY",
  "SUBTITLE_GENERATION",
  "SUBTITLE_BURN",
  "AD_OVERLAY",
  "COVER_RENDER",
  "FINAL_CONCAT",
  "OUTPUT_VALIDATE",
];

export interface RenderedScene {
  scene_id: string;
  source_id: string;
  clip_id: string;
  source_start: number;
  source_end: number;
  timeline_start: number;
  timeline_end: number;
  duration: number;
  file: string;
}

export interface RenderResult {
  status: "RUNNING" | "SUCCESS" | "FAILED";
  substages: Record<RenderSubstageName, StageState>;
  scene_plan: RenderedScene[];
  assembled_file?: string;
  body_file?: string;
  cover_file?: string;
  final_file?: string;
  final_media_path?: string;
  body_duration?: number;
  cover_duration?: number;
  final_duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  video_codec?: string;
  audio_codec?: string;
  file_size?: number;
  first_frame_matches_cover?: boolean;
  decode_verified?: boolean;
}

// A "queue job" wraps one of the three long-running HTTP-triggered stage
// groups (TTS generation; OCR+CLIP+ALLOCATE+VALIDATE "analyze"; RENDER) so
// it can run on a background worker instead of inside the request handler.
// This is deliberately a thin layer on top of the existing `stages`/
// `render` tracking below, not a replacement for it — QUEUED/RUNNING/
// COMPLETED/FAILED here means "is the background worker touching this right
// now", while the granular per-stage state keeps meaning exactly what it
// always has.
export type QueueKind = "tts" | "analyze" | "render";
export type QueueStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";

export interface JobQueueMeta {
  kind: QueueKind;
  status: QueueStatus;
  currentStage?: StageName;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  workerId?: string;
  retryCount: number;
  maxRetries: number;
  lastError?: JobError;
}

export type NotificationStatus = "PENDING" | "SUCCESS" | "FAILED" | "SKIPPED";

// Push notification delivery is tracked separately from the job's own
// success/failure so a push failure can never flip a completed render to
// FAILED (see JobQueueMeta.status, which is unaffected by this).
export interface JobNotificationState {
  status: NotificationStatus;
  sentAt?: string;
  reason?: string;
}

export interface Job {
  job_id: string;
  created_at: string;
  updated_at: string;
  stages: Record<StageName, StageState>;
  tts?: TtsResult;
  cover: CoverSettings;
  subtitle: SubtitleResult;
  bgm: BgmSettings;
  ocr_enabled: boolean;
  ad_label_enabled: boolean;
  sources: SourceVideo[];
  ocr: Record<string, OcrSegment[]>;
  clips: Clip[];
  scenes: Scene[];
  allocation_decisions?: AllocationDecision[];
  validation?: ValidationResult;
  render?: RenderResult;
  logs: JobLogEntry[];
  queue?: JobQueueMeta;
  notification?: JobNotificationState;
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
