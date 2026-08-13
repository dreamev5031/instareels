import assert from "node:assert/strict";
import test from "node:test";
import { buildAudioMuxArgs } from "@/render";

test("BGM mix keeps TTS gain fixed and applies only the saved BGM volume", () => {
  const args = buildAudioMuxArgs({
    videoOnly: "video.mp4",
    ttsPath: "tts.mp3",
    ttsDuration: 8.25,
    assembled: "assembled.mp4",
    bgmFile: "bgm.mp3",
    bgmVolume: 0.27,
  });
  const filter = args[args.indexOf("-filter_complex") + 1]!;
  assert.match(filter, /\[1:a\]volume=1\.0\[tts\]/u);
  assert.match(filter, /\[2:a\]volume=0\.27,/u);
  assert.match(filter, /amix=inputs=2:duration=first:dropout_transition=0:normalize=0/u);
  assert.ok(args.includes("-stream_loop"));
});

test("no BGM preserves the original TTS-only audio path", () => {
  const args = buildAudioMuxArgs({
    videoOnly: "video.mp4",
    ttsPath: "tts.mp3",
    ttsDuration: 8.25,
    assembled: "assembled.mp4",
  });
  assert.equal(args.includes("-filter_complex"), false);
  assert.deepEqual(args.slice(0, 9), ["-y", "-i", "video.mp4", "-i", "tts.mp3", "-map", "0:v:0", "-map", "1:a:0"]);
});
