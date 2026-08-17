import assert from "node:assert/strict";
import test from "node:test";
import {
  COVER_TEXT_STYLE,
  coverMainLineHeight,
  coverSubLineHeight,
  coverTextGap,
  coverVerticalCenterPercent,
  wrapCoverText,
} from "./style";

function closeTo(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} != ${expected}`);
}

test("cover typography keeps legacy insta-ad-generator defaults", () => {
  assert.equal(COVER_TEXT_STYLE.mainFontSize, 112);
  assert.equal(COVER_TEXT_STYLE.subFontSize, 64);
  closeTo(coverMainLineHeight(), 125.44);
  closeTo(coverSubLineHeight(), 75.52);
  closeTo(coverTextGap(), 33.28);
  assert.equal(coverVerticalCenterPercent("top"), 19);
});

test("long Korean main copy wraps naturally into centered cover lines", () => {
  assert.deepEqual(wrapCoverText("걸보기엔 그냥 거울인데", COVER_TEXT_STYLE.mainMaxCharacters), ["걸보기엔 그냥", "거울인데"]);
  assert.deepEqual(wrapCoverText("좁은 집에서 발견한 꿀팁", COVER_TEXT_STYLE.subMaxCharacters), ["좁은 집에서 발견한 꿀팁"]);
});
