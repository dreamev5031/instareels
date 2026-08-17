import assert from "node:assert/strict";
import test from "node:test";
import type { Job } from "@/shared/types";
import { invalidateVideoComposition, nextSourceId } from "./index";

function pendingStages() {
  return Object.fromEntries(
    ["TTS", "COVER", "UPLOAD", "OCR", "CLIP", "ALLOCATE", "VALIDATE", "RENDER"].map((name) => [name, { status: "SUCCESS" }]),
  ) as Job["stages"];
}

test("source ids never collide after deleting a middle source", () => {
  const job = {
    sources: [
      { source_id: "SOURCE_001" },
      { source_id: "SOURCE_003" },
    ],
  } as unknown as Job;
  assert.equal(nextSourceId(job), "SOURCE_004");
});

test("source composition change clears derived video analysis but preserves TTS and cover", () => {
  const tts = { status: "success", duration: 10 };
  const cover = { main_text: "메인", sub_text: "서브" };
  const job = {
    stages: pendingStages(),
    tts,
    cover,
    sources: [{ source_id: "SOURCE_001", status: "ANALYZED" }],
    ocr: { SOURCE_001: [{ start: 0, end: 1, ocr_safe: true }] },
    clips: [{ clip_id: "CLIP_001", source_id: "SOURCE_001" }],
    scenes: [{ scene_id: "SCENE_001", source_id: "SOURCE_001" }],
    allocation_decisions: [{ scene_id: "SCENE_001" }],
    validation: { status: "PASS" },
    render: { status: "SUCCESS" },
  } as unknown as Job;

  invalidateVideoComposition(job);

  assert.equal(job.tts, tts);
  assert.equal(job.cover, cover);
  assert.deepEqual(job.ocr, {});
  assert.deepEqual(job.clips, []);
  assert.deepEqual(job.scenes, []);
  assert.equal(job.allocation_decisions, undefined);
  assert.equal(job.validation, undefined);
  assert.equal(job.render, undefined);
  assert.equal(job.sources[0]?.status, "PENDING");
  assert.equal(job.stages.CLIP.status, "PENDING");
  assert.equal(job.stages.ALLOCATE.status, "PENDING");
  assert.equal(job.stages.VALIDATE.status, "PENDING");
  assert.equal(job.stages.RENDER.status, "PENDING");
  assert.equal(job.video_sources_changed, true);
});
