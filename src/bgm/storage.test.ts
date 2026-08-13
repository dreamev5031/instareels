import assert from "node:assert/strict";
import test from "node:test";
import {
  bgmIdForKey,
  friendlyBgmName,
  isValidBgmId,
  parseByteRange,
} from "@/bgm/storage";
import { BgmUploadError, MAX_BGM_UPLOAD_BYTES, validateBgmUpload } from "@/bgm/upload";
import { POST as uploadBgmRequest } from "../../app/api/bgm/upload/route";

test("BGM object keys become opaque, validated IDs", () => {
  const id = bgmIdForKey("bgm/My_Private_Track.mp3");
  assert.match(id, /^[a-f0-9]{64}$/u);
  assert.equal(isValidBgmId(id), true);
  assert.equal(isValidBgmId("../bgm/track.mp3"), false);
  assert.doesNotMatch(id, /My_Private_Track/u);
});

test("BGM names are friendly and do not include the extension", () => {
  assert.equal(friendlyBgmName("bgm/folder/summer_trip-theme.mp3"), "summer trip theme");
  assert.equal(friendlyBgmName("bgm/집중할_시간.MP3"), "집중할 시간");
  assert.equal(friendlyBgmName("bgm/happy-shopping-01.m4a"), "happy shopping 01");
});

test("byte ranges support bounded, open-ended, and suffix requests", () => {
  assert.deepEqual(parseByteRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(parseByteRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(parseByteRange("bytes=-20", 100), { start: 80, end: 99 });
  assert.deepEqual(parseByteRange("bytes=90-200", 100), { start: 90, end: 99 });
  assert.equal(parseByteRange("bytes=100-101", 100), undefined);
  assert.equal(parseByteRange("bytes=20-10", 100), undefined);
  assert.equal(parseByteRange("bytes=0-1,4-5", 100), undefined);
});

test("BGM upload accepts supported audio extensions and enforces the size limit", () => {
  for (const name of ["music.mp3", "music.wav", "music.m4a", "music.aac"]) {
    assert.equal(validateBgmUpload({ name, size: 1024 }), name.slice(name.lastIndexOf(".")));
  }
  assert.throws(
    () => validateBgmUpload({ name: "music.flac", size: 1024 }),
    (error: unknown) => error instanceof BgmUploadError && error.code === "BGM_UNSUPPORTED_FORMAT",
  );
  assert.throws(
    () => validateBgmUpload({ name: "music.mp3", size: MAX_BGM_UPLOAD_BYTES + 1 }),
    (error: unknown) => error instanceof BgmUploadError && error.code === "BGM_UPLOAD_TOO_LARGE",
  );
});

test("BGM upload API returns structured JSON for invalid files and malformed form data", async () => {
  const unsupported = new FormData();
  unsupported.append("file", new File([new Uint8Array([1, 2, 3])], "music.flac", { type: "audio/flac" }));
  const unsupportedResponse = await uploadBgmRequest(new Request("http://localhost/api/bgm/upload", {
    method: "POST",
    body: unsupported,
  }));
  assert.equal(unsupportedResponse.status, 400);
  assert.equal((await unsupportedResponse.json()).error_code, "BGM_UNSUPPORTED_FORMAT");

  const malformedResponse = await uploadBgmRequest(new Request("http://localhost/api/bgm/upload", {
    method: "POST",
    headers: { "Content-Type": "multipart/form-data; boundary=broken" },
    body: "not-a-valid-multipart-body",
  }));
  assert.equal(malformedResponse.status, 400);
  assert.equal((await malformedResponse.json()).error_code, "FORMDATA_PARSE_FAILED");
});
