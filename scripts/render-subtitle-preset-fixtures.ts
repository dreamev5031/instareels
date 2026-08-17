import fs from "node:fs/promises";
import path from "node:path";
import type { SubtitleSegment, SubtitleSettings } from "@/shared/types";
import { SUBTITLE_EFFECTS } from "@/shared/types";
import { writeAssFile } from "@/subtitle/ass";
import { prepareRenderFont, readRenderFontFamily } from "@/render/fonts";
import { runFfmpeg } from "@/shared/ffmpeg";

const ROOT = path.resolve(process.argv[2] || "artifacts/subtitle-presets");
const SAMPLE_TIMES = [0.35, 0.8, 1.2, 2.0, 3.3, 4.7] as const;
const settings: SubtitleSettings = {
  enabled: true,
  font: "pretendard",
  size: 104,
  color: "#ffffff",
  stroke_enabled: true,
  shadow_enabled: true,
  vertical_position: "bottom",
  effect: "typewriter",
};
const segments: SubtitleSegment[] = [
  { segment_id: "SUBTITLE_001", text: "이 제품은 생각보다", start: 0.05, end: 1.4, word_timings: [
    { text: "이", start: 0.05, end: 0.2 }, { text: "제품은", start: 0.22, end: 0.62 }, { text: "생각보다", start: 0.66, end: 1.3 },
  ] },
  { segment_id: "SUBTITLE_002", text: "훨씬 괜찮아서 실제로", start: 1.4, end: 2.8, word_timings: [
    { text: "훨씬", start: 1.42, end: 1.75 }, { text: "괜찮아서", start: 1.78, end: 2.32 }, { text: "실제로", start: 2.36, end: 2.72 },
  ] },
  { segment_id: "SUBTITLE_003", text: "며칠 써보고도 계속", start: 2.8, end: 4.1, word_timings: [
    { text: "며칠", start: 2.82, end: 3.12 }, { text: "써보고도", start: 3.15, end: 3.68 }, { text: "계속", start: 3.72, end: 4.02 },
  ] },
  { segment_id: "SUBTITLE_004", text: "사용하고 있습니다.", start: 4.1, end: 5.4, word_timings: [
    { text: "사용하고", start: 4.12, end: 4.72 }, { text: "있습니다.", start: 4.76, end: 5.32 },
  ] },
];

const escaped = (value: string) => value.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");

async function main() {
  await fs.rm(ROOT, { recursive: true, force: true });
  await fs.mkdir(ROOT, { recursive: true });
  const fontsDir = path.join(ROOT, "fonts");
  const fontFile = await prepareRenderFont("pretendard", fontsDir);
  const fontFamily = await readRenderFontFamily(fontFile);
  const report = [];

  for (const effect of SUBTITLE_EFFECTS) {
    const assFile = path.join(ROOT, `${effect}.ass`);
    const mp4File = path.join(ROOT, `${effect}.mp4`);
    const eventCount = await writeAssFile(assFile, segments, { ...settings, effect }, fontFamily);
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "color=c=#15131d:s=540x960:r=30:d=5.5",
      "-vf", `subtitles=filename='${escaped(assFile)}':fontsdir='${escaped(fontsDir)}'`,
      "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", mp4File,
    ]);
    await runFfmpeg(["-v", "error", "-i", mp4File, "-f", "null", "-"]);
    const frames = [];
    for (const seconds of SAMPLE_TIMES) {
      const frame = path.join(ROOT, `${effect}-${seconds.toFixed(2)}.jpg`);
      await runFfmpeg(["-y", "-ss", String(seconds), "-i", mp4File, "-frames:v", "1", "-q:v", "2", frame]);
      frames.push(path.basename(frame));
    }
    report.push({ effect, event_count: eventCount, mp4: path.basename(mp4File), frames });
  }

  await fs.writeFile(path.join(ROOT, "report.json"), JSON.stringify({
    sentence: "이 제품은 생각보다 훨씬 괜찮아서 실제로 며칠 써보고도 계속 사용하고 있습니다.",
    settings,
    results: report,
  }, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
