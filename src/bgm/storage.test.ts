import assert from "node:assert/strict";
import test from "node:test";
import {
  bgmIdForKey,
  friendlyBgmName,
  isValidBgmId,
  parseByteRange,
} from "@/bgm/storage";

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
