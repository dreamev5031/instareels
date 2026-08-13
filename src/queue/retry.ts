import type { ErrorCode } from "@/shared/types";

/**
 * Error codes worth a limited retry because they typically indicate a
 * transient infra/network problem (an upstream API hiccup, a font CDN
 * fetch, a Bucket download) rather than a logic error that will fail
 * identically every time. Everything NOT listed here is treated as
 * permanent — deliberately conservative, since an unbounded retry loop is
 * worse than under-retrying. Voice/validation/format mistakes (bad Voice
 * ID, insufficient duration, VALIDATE failures, unsupported formats, etc.)
 * are intentionally absent: retrying them just wastes attempts on a result
 * that cannot change.
 */
const RETRYABLE_ERROR_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "ELEVENLABS_API_ERROR",
  "TTS_GENERATION_FAILED",
  "VOICE_REGISTRY_UNAVAILABLE",
  "FONT_PREPARE_FAILED",
  "VIDEO_ASSEMBLY_FAILED",
  "RENDER_DECODE_FAILED",
  "SOURCE_DECODE_FAILED",
]);

export function isRetryableErrorCode(code: string | undefined): boolean {
  return Boolean(code && RETRYABLE_ERROR_CODES.has(code as ErrorCode));
}

export function queueMaxRetries(): number {
  const raw = Number(process.env.QUEUE_MAX_RETRIES);
  return Number.isInteger(raw) && raw >= 0 && raw <= 5 ? raw : 2;
}
