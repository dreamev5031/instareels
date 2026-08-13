import assert from "node:assert/strict";
import test from "node:test";
import { isRetryableErrorCode, queueMaxRetries } from "./retry";

test("known transient/infra codes are retryable", () => {
  for (const code of ["ELEVENLABS_API_ERROR", "TTS_GENERATION_FAILED", "VOICE_REGISTRY_UNAVAILABLE", "FONT_PREPARE_FAILED", "VIDEO_ASSEMBLY_FAILED", "RENDER_DECODE_FAILED", "SOURCE_DECODE_FAILED"]) {
    assert.equal(isRetryableErrorCode(code), true, `${code} should be retryable`);
  }
});

test("logic/validation errors are never retried — retrying them cannot change the outcome", () => {
  for (const code of [
    "INSUFFICIENT_TOTAL_DURATION",
    "VOICE_NOT_FOUND",
    "TTS_PROVIDER_VOICE_MISMATCH",
    "ELEVENLABS_VOICE_REQUIRED",
    "TTS_EMPTY_TEXT",
    "COVER_IMAGE_REQUIRED",
    "UPLOAD_UNSUPPORTED_FORMAT",
    "RENDER_VALIDATE_REQUIRED",
    "RENDER_OUTPUT_INVALID",
    "SUBTITLE_TIMING_FAILED",
    "ELEVENLABS_QUOTA_EXCEEDED",
  ]) {
    assert.equal(isRetryableErrorCode(code), false, `${code} should NOT be retryable`);
  }
});

test("unknown/undefined codes default to non-retryable (fail closed, never loop forever)", () => {
  assert.equal(isRetryableErrorCode(undefined), false);
  assert.equal(isRetryableErrorCode("SOME_FUTURE_CODE_NOT_YET_CLASSIFIED"), false);
});

test("queueMaxRetries reads QUEUE_MAX_RETRIES within a sane bound, else defaults to 2", () => {
  const original = process.env.QUEUE_MAX_RETRIES;
  try {
    delete process.env.QUEUE_MAX_RETRIES;
    assert.equal(queueMaxRetries(), 2);

    process.env.QUEUE_MAX_RETRIES = "4";
    assert.equal(queueMaxRetries(), 4);

    process.env.QUEUE_MAX_RETRIES = "999";
    assert.equal(queueMaxRetries(), 2, "out-of-range values fall back to the default rather than allowing unbounded retries");

    process.env.QUEUE_MAX_RETRIES = "not-a-number";
    assert.equal(queueMaxRetries(), 2);
  } finally {
    if (original === undefined) delete process.env.QUEUE_MAX_RETRIES;
    else process.env.QUEUE_MAX_RETRIES = original;
  }
});
