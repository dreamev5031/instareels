import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { runAllocateStage } from "@/allocator";
import { runCoverStage } from "@/cover";
import { runClipStage } from "@/clips";
import { runOcrStage } from "@/ocr";
import { createDefaultBgmSettings, createDefaultCoverSettings, createDefaultSubtitleSettings, STAGE_ORDER, Job, PipelineError, SourceVideo, StageStatus } from "@/shared/types";
import { runTtsStage } from "@/tts";
import { MAX_UPLOAD_FILE_BYTES, MAX_UPLOAD_REQUEST_BYTES, MAX_UPLOAD_TOTAL_BYTES, runUploadStage, validateUploadSizes } from "@/upload";
import { runValidateStage } from "@/validator";
import { runRenderStage } from "@/render";
import { POST as uploadRequest } from "../app/api/upload/route";
import { ApiRequestError, parseJobResponse } from "@/ui/api";

let jobSequence = 0;

function makeJob(ttsDuration = 0): Job {
  jobSequence += 1;
  const now = new Date().toISOString();
  const stages = Object.fromEntries(
    STAGE_ORDER.map((stage) => [stage, { status: "PENDING" as StageStatus }])
  ) as Job["stages"];
  if (ttsDuration > 0) stages.TTS = { status: "SUCCESS" };
  return {
    job_id: `JOB_TEST_${jobSequence}`,
    created_at: now,
    updated_at: now,
    stages,
    cover: createDefaultCoverSettings(),
    subtitle: { status: "PENDING", settings: createDefaultSubtitleSettings(), segments: [] },
    bgm: createDefaultBgmSettings(),
    ocr_enabled: false,
    tts:
      ttsDuration > 0
        ? { status: "success", provider: "edge", text: "test", voice: "ko-KR-SunHiNeural", file: "tts.mp3", audio_path: "tts.mp3", duration: ttsDuration, timing: { source: "duration_fallback", words: [] } }
        : undefined,
    sources: [],
    ocr: {},
    clips: [],
    scenes: [],
    logs: [],
  };
}

function addSource(job: Job, sourceId: string, duration: number): SourceVideo {
  const source: SourceVideo = {
    source_id: sourceId,
    original_filename: `${sourceId}.mp4`,
    file: `${sourceId}.mp4`,
    duration,
    width: 1080,
    height: 1920,
    fps: 30,
    status: "ANALYZED",
  };
  job.sources.push(source);
  return source;
}

function addSafeSource(job: Job, sourceId: string, duration: number): void {
  addSource(job, sourceId, duration);
  job.ocr[sourceId] = [{ start: 0, end: duration, ocr_safe: true, confidence: 99 }];
}

test("K: cover image is required and the failure is recorded on COVER", async () => {
  const job = makeJob(3);
  job.stages.TTS.status = "SUCCESS";
  await runCoverStage(job, { settings: createDefaultCoverSettings() });

  assert.equal(job.stages.COVER.status, "FAILED");
  assert.equal(job.stages.COVER.error?.error_code, "COVER_IMAGE_REQUIRED");
});

test("L: cover settings and uploaded image are persisted without changing analysis stages", async () => {
  const job = makeJob(3);
  job.stages.TTS.status = "SUCCESS";
  const settings = {
    ...createDefaultCoverSettings(),
    main_text: "메인 문구",
    sub_text: "서브 문구",
    main_font: "pretendard" as const,
    sub_font: "yg-jalnan" as const,
    use_same_font: false,
    vertical_position: "bottom" as const,
  };
  await runCoverStage(job, {
    settings,
    file: {
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      originalFilename: "cover.png",
      mimeType: "image/png",
      size: 8,
    },
  });

  assert.equal(job.stages.COVER.status, "SUCCESS");
  assert.equal(job.cover.main_text, "메인 문구");
  assert.equal(job.cover.sub_font, "yg-jalnan");
  assert.equal(job.cover.vertical_position, "bottom");
  assert.equal(job.stages.UPLOAD.status, "PENDING");
  assert.ok(job.cover.image && fs.existsSync(job.cover.image.file));
});

function allocateAndValidate(job: Job): void {
  runClipStage(job);
  runAllocateStage(job);
  runValidateStage(job);
}

function assertNoDuplicateAllocation(job: Job): void {
  assert.equal(new Set(job.scenes.map((scene) => scene.clip_id)).size, job.scenes.length);
  for (const source of job.sources) {
    const ranges = job.scenes
      .filter((scene) => scene.source_id === source.source_id)
      .sort((a, b) => a.source_start - b.source_start);
    for (let index = 0; index < ranges.length - 1; index += 1) {
      assert.ok(ranges[index]!.source_end <= ranges[index + 1]!.source_start + 0.001);
    }
  }
}

test("A: short TTS rotates across multiple safe sources", () => {
  const job = makeJob(2.5);
  addSafeSource(job, "SOURCE_001", 4);
  addSafeSource(job, "SOURCE_002", 4);
  addSafeSource(job, "SOURCE_003", 4);

  allocateAndValidate(job);

  assert.equal(job.validation?.status, "PASS");
  assert.equal(job.scenes.at(-1)?.timeline_end, 2.5);
  assert.ok(new Set(job.scenes.map((scene) => scene.source_id)).size >= 2);
  assertNoDuplicateAllocation(job);
});

test("B: long TTS fills the timeline and keeps sequential scene ids", () => {
  const job = makeJob(10);
  addSafeSource(job, "SOURCE_001", 6);
  addSafeSource(job, "SOURCE_002", 6);
  addSafeSource(job, "SOURCE_003", 6);

  allocateAndValidate(job);

  assert.equal(job.scenes.reduce((sum, scene) => sum + scene.duration, 0), 10);
  assert.deepEqual(
    job.scenes.map((scene) => scene.scene_id),
    job.scenes.map((_, index) => `SCENE_${String(index + 1).padStart(3, "0")}`)
  );
  assert.equal(job.allocation_decisions?.length, job.scenes.length);
  assertNoDuplicateAllocation(job);
});

test("C: a single source may repeat, but clips and ranges never do", () => {
  const job = makeJob(4.5);
  addSafeSource(job, "SOURCE_001", 6);

  allocateAndValidate(job);

  assert.equal(job.validation?.status, "PASS");
  assert.ok(job.scenes.length > 1);
  assertNoDuplicateAllocation(job);
});

test("D: OCR blocked ranges are never converted into allocated clips", () => {
  const job = makeJob(4);
  job.ocr_enabled = true;
  addSource(job, "SOURCE_001", 6);
  job.ocr.SOURCE_001 = [
    { start: 0, end: 4, ocr_safe: false, reason: "TEXT_DETECTED", confidence: 95 },
    { start: 4, end: 6, ocr_safe: true, confidence: 99 },
  ];
  addSafeSource(job, "SOURCE_002", 6);

  allocateAndValidate(job);

  assert.equal(job.validation?.checks.find((check) => check.code === "OCR_BLOCKED_USED")?.passed, true);
  assert.ok(job.scenes.filter((scene) => scene.source_id === "SOURCE_001").every((scene) => scene.source_start >= 4));
});

test("E: insufficient SAFE duration fails at ALLOCATE with actionable context", () => {
  const job = makeJob(3);
  addSafeSource(job, "SOURCE_001", 2);
  runClipStage(job);

  assert.throws(() => runAllocateStage(job), (error: unknown) => {
    assert.ok(error instanceof PipelineError);
    assert.equal(error.code, "INSUFFICIENT_TOTAL_DURATION");
    return true;
  });
  assert.equal(job.stages.ALLOCATE.status, "FAILED");
  assert.equal(job.stages.ALLOCATE.error?.context?.shortage, 1);
});

test("F: one source with many clips does not monopolize allocation while alternatives exist", () => {
  const job = makeJob(10);
  addSafeSource(job, "SOURCE_001", 20);
  addSafeSource(job, "SOURCE_002", 4);
  addSafeSource(job, "SOURCE_003", 4);

  allocateAndValidate(job);

  const ratios = Object.values(job.validation?.source_usage ?? {}).map((usage) => usage.ratio);
  assert.ok(Math.max(...ratios) <= 0.6);
  assert.equal(job.validation?.checks.find((check) => check.code === "SOURCE_OVERUSE")?.passed, true);
});

test("G: allocator never reuses a clip and records every successful selection", () => {
  const job = makeJob(8);
  addSafeSource(job, "SOURCE_001", 8);
  addSafeSource(job, "SOURCE_002", 8);

  allocateAndValidate(job);

  assertNoDuplicateAllocation(job);
  assert.equal(job.allocation_decisions?.length, job.scenes.length);
  for (const decision of job.allocation_decisions ?? []) {
    assert.ok(decision.candidate_count >= decision.eligible_candidate_count);
    assert.ok(decision.source_used_duration_after >= decision.source_used_duration_before);
  }
});

test("G2: validator ignores only millisecond boundary rounding, not real range overlap", () => {
  const rounded = makeJob(2);
  addSafeSource(rounded, "SOURCE_001", 4);
  rounded.scenes = [
    { scene_id: "SCENE_001", timeline_start: 0, timeline_end: 1, duration: 1, source_id: "SOURCE_001", clip_id: "A", source_start: 0, source_end: 1.001 },
    { scene_id: "SCENE_002", timeline_start: 1, timeline_end: 2, duration: 1, source_id: "SOURCE_001", clip_id: "B", source_start: 1, source_end: 2 },
  ];
  runValidateStage(rounded);
  assert.equal(rounded.validation?.checks.find((check) => check.code === "DUPLICATE_RANGE")?.passed, true);

  const overlapping = makeJob(2);
  addSafeSource(overlapping, "SOURCE_001", 4);
  overlapping.scenes = [
    { scene_id: "SCENE_001", timeline_start: 0, timeline_end: 1, duration: 1, source_id: "SOURCE_001", clip_id: "A", source_start: 0, source_end: 1.01 },
    { scene_id: "SCENE_002", timeline_start: 1, timeline_end: 2, duration: 1, source_id: "SOURCE_001", clip_id: "B", source_start: 1, source_end: 2 },
  ];
  assert.throws(() => runValidateStage(overlapping));
  assert.equal(overlapping.validation?.checks.find((check) => check.code === "DUPLICATE_RANGE")?.passed, false);
});

test("H: OCR engine failure identifies stage, source, and frame", async () => {
  const job = makeJob(2);
  job.ocr_enabled = true;
  addSource(job, "SOURCE_001", 2);
  const fakeEngine = {
    async recognize() {
      throw new Error("simulated OCR failure");
    },
    async dispose() {},
  };

  await assert.rejects(
    runOcrStage(job, undefined, {
      createEngine: () => fakeEngine,
      extractFrames: async () => ["frame_00001.jpg"],
    }),
    (error: unknown) => {
      assert.ok(error instanceof PipelineError);
      assert.equal(error.code, "OCR_ENGINE_FAILED");
      assert.equal(error.source_id, "SOURCE_001");
      return true;
    }
  );
  assert.equal(job.stages.OCR.status, "FAILED");
  assert.equal(job.sources[0]?.status, "FAILED");
  assert.equal(job.stages.OCR.error?.context?.frame, "frame_00001.jpg");
});

test("I: TTS generation failure remains visible as a TTS stage error", async () => {
  const job = makeJob();

  await assert.rejects(
    runTtsStage(job, "테스트 나레이션", "ko-KR-SunHiNeural", {
      synthesizeSpeech: async () => {
        throw new Error("simulated Edge TTS failure");
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof PipelineError);
      assert.equal(error.code, "TTS_GENERATION_FAILED");
      return true;
    }
  );
  assert.equal(job.stages.TTS.status, "FAILED");
  assert.match(job.stages.TTS.error?.message ?? "", /simulated Edge TTS failure/);
});

test("J: ffprobe failure identifies the upload stage and source", async () => {
  const job = makeJob(2);

  await assert.rejects(
    runUploadStage(
      job,
      [{ originalFilename: "broken.mp4", buffer: Buffer.from("not-video") }],
      {
        probeMedia: async () => {
          throw new Error("simulated ffprobe failure");
        },
        extractThumbnail: async () => {},
      }
    ),
    (error: unknown) => {
      assert.ok(error instanceof PipelineError);
      assert.equal(error.code, "UPLOAD_PROBE_FAILED");
      assert.equal(error.source_id, "SOURCE_001");
      return true;
    }
  );
  assert.equal(job.stages.UPLOAD.status, "FAILED");
  assert.equal(job.stages.UPLOAD.error?.source_id, "SOURCE_001");
  assert.match(String(job.stages.UPLOAD.error?.context?.error), /simulated ffprobe failure/);
});

test("P: MP4 and MOV pass extension validation only after a real video probe result", async () => {
  const job = makeJob(2);
  const probeResult = {
    duration: 2,
    width: 1080,
    height: 1920,
    fps: 30,
    codecName: "hevc",
    containerFormat: "mov,mp4,m4a,3gp,3g2,mj2",
  };
  await runUploadStage(
    job,
    [
      { originalFilename: "h264.mp4", buffer: Buffer.from("mp4") },
      { originalFilename: "iphone-hevc.mov", buffer: Buffer.from("mov") },
    ],
    { probeMedia: async () => probeResult, extractThumbnail: async () => {} },
  );
  assert.equal(job.stages.UPLOAD.status, "SUCCESS");
  assert.deepEqual(job.sources.map((source) => source.original_filename), ["h264.mp4", "iphone-hevc.mov"]);
  assert.deepEqual(job.sources.map((source) => source.codec_name), ["hevc", "hevc"]);
});

test("P2: upload limits distinguish individual and aggregate file sizes", () => {
  assert.doesNotThrow(() => validateUploadSizes([
    { originalFilename: "first.mp4", size: 90_000_000 },
    { originalFilename: "second.mov", size: 90_000_000 },
  ]));
  assert.throws(
    () => validateUploadSizes([{ originalFilename: "large.mp4", size: MAX_UPLOAD_FILE_BYTES + 1 }]),
    (error: unknown) => {
      assert.ok(error instanceof PipelineError);
      assert.equal(error.code, "UPLOAD_TOO_LARGE");
      assert.equal(error.context?.limit_type, "FILE");
      assert.equal(error.context?.max_file_size, MAX_UPLOAD_FILE_BYTES);
      return true;
    },
  );
  assert.throws(
    () => validateUploadSizes([
      { originalFilename: "first.mp4", size: 90_000_000 },
      { originalFilename: "second.mov", size: MAX_UPLOAD_TOTAL_BYTES - 90_000_000 + 1 },
    ]),
    (error: unknown) => {
      assert.ok(error instanceof PipelineError);
      assert.equal(error.code, "UPLOAD_TOO_LARGE");
      assert.equal(error.context?.limit_type, "TOTAL");
      assert.equal(error.context?.max_total_size, MAX_UPLOAD_TOTAL_BYTES);
      return true;
    },
  );
});

test("P3: malformed and oversized multipart requests always return JSON errors", async () => {
  const malformed = await uploadRequest(new Request("http://localhost/api/upload", {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=broken" },
    body: "not-a-valid-multipart-body",
  }));
  assert.equal(malformed.status, 400);
  assert.match(malformed.headers.get("content-type") ?? "", /application\/json/);
  const malformedBody = await malformed.json();
  assert.equal(malformedBody.error_code, "FORMDATA_PARSE_FAILED");

  const oversized = await uploadRequest(new Request("http://localhost/api/upload", {
    method: "POST",
    headers: {
      "content-type": "multipart/form-data; boundary=unused",
      "content-length": String(MAX_UPLOAD_REQUEST_BYTES + 1),
    },
    body: "unused",
  }));
  assert.equal(oversized.status, 413);
  assert.match(oversized.headers.get("content-type") ?? "", /application\/json/);
  const oversizedBody = await oversized.json();
  assert.equal(oversizedBody.error_code, "UPLOAD_TOO_LARGE");
  assert.equal(oversizedBody.context.limit_type, "REQUEST");
});

test("P4: frontend response parsing replaces empty or non-JSON bodies with structured errors", async () => {
  await assert.rejects(
    parseJobResponse(new Response(null, { status: 502 }), "UPLOAD"),
    (error: unknown) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.stage, "UPLOAD");
      assert.equal(error.errorCode, "EMPTY_RESPONSE");
      assert.doesNotMatch(error.message, /Unexpected end of JSON input/);
      return true;
    },
  );
  await assert.rejects(
    parseJobResponse(new Response("<html>failure</html>", {
      status: 502,
      headers: { "content-type": "text/html" },
    }), "UPLOAD"),
    (error: unknown) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.errorCode, "INVALID_RESPONSE_CONTENT_TYPE");
      return true;
    },
  );
});

test("Q: render is rejected unless VALIDATE passed", async () => {
  const job = makeJob(2);
  await assert.rejects(runRenderStage(job), (error: unknown) => {
    assert.ok(error instanceof PipelineError);
    assert.equal(error.code, "RENDER_VALIDATE_REQUIRED");
    return true;
  });
  assert.equal(job.stages.RENDER.status, "PENDING");
});

test("M: every analysis stage rejects a JOB without a completed TTS", async () => {
  const ocrJob = makeJob();
  await assert.rejects(runOcrStage(ocrJob), (error: unknown) => {
    assert.ok(error instanceof PipelineError);
    assert.equal(error.code, "TTS_REQUIRED");
    return true;
  });
  assert.equal(ocrJob.stages.OCR.status, "FAILED");
  assert.equal(ocrJob.stages.OCR.error?.error_code, "TTS_REQUIRED");

  const stages = [
    ["CLIP", runClipStage],
    ["ALLOCATE", runAllocateStage],
    ["VALIDATE", runValidateStage],
  ] as const;
  for (const [stage, run] of stages) {
    const job = makeJob();
    assert.throws(() => run(job), (error: unknown) => {
      assert.ok(error instanceof PipelineError);
      assert.equal(error.code, "TTS_REQUIRED");
      return true;
    });
    assert.equal(job.stages[stage].status, "FAILED");
    assert.equal(job.stages[stage].error?.error_code, "TTS_REQUIRED");
  }
});

test("N: OCR OFF skips the engine, marks the full source SAFE, and validates normally", async () => {
  const job = makeJob(2);
  addSource(job, "SOURCE_001", 3);
  let engineCreated = false;
  let framesExtracted = false;

  await runOcrStage(job, undefined, {
    createEngine: () => {
      engineCreated = true;
      throw new Error("OCR engine must not be created while disabled");
    },
    extractFrames: async () => {
      framesExtracted = true;
      return [];
    },
  });

  assert.equal(engineCreated, false);
  assert.equal(framesExtracted, false);
  assert.equal(job.stages.OCR.status, "SKIPPED");
  assert.equal(job.stages.OCR.skipReason, "DISABLED_BY_USER");
  assert.deepEqual(job.ocr.SOURCE_001, [{ start: 0, end: 3, ocr_safe: true }]);

  runClipStage(job);
  runAllocateStage(job);
  runValidateStage(job);
  assert.equal(job.validation?.status, "PASS");
  const ocrCheck = job.validation?.checks.find((check) => check.code === "OCR_BLOCKED_USED");
  assert.equal(ocrCheck?.skipped, true);
  assert.equal(ocrCheck?.skip_reason, "DISABLED_BY_USER");
});

test("O: OCR ON runs the engine, blocks detected text, and allocates SAFE ranges only", async () => {
  const job = makeJob(1);
  job.ocr_enabled = true;
  addSource(job, "SOURCE_001", 2);
  let recognitionCount = 0;
  const fakeEngine = {
    async recognize() {
      recognitionCount += 1;
      return recognitionCount === 1
        ? { rawText: "中文", confidence: 98 }
        : { rawText: "", confidence: 99 };
    },
    async dispose() {},
  };

  await runOcrStage(job, undefined, {
    createEngine: () => fakeEngine,
    extractFrames: async () => ["frame_00001.jpg", "frame_00002.jpg"],
  });

  assert.equal(recognitionCount, 2);
  assert.equal(job.stages.OCR.status, "SUCCESS");
  assert.equal(job.ocr.SOURCE_001?.filter((segment) => !segment.ocr_safe).length, 1);

  runClipStage(job);
  assert.ok(job.clips.every((clip) => clip.source_start >= 1));
  runAllocateStage(job);
  runValidateStage(job);
  assert.equal(job.validation?.status, "PASS");
  assert.equal(job.validation?.checks.find((check) => check.code === "OCR_BLOCKED_USED")?.skipped, undefined);
});
