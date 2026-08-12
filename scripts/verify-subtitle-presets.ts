import fs from "node:fs/promises";
import path from "node:path";
import { loadJob } from "@/jobs/store";
import { jobRenderDir } from "@/jobs/paths";
import { SUBTITLE_EFFECTS } from "@/shared/types";
import { writeAssFile } from "@/subtitle/ass";
import { prepareRenderFont, readRenderFontFamily } from "@/render/fonts";
import { runFfmpeg } from "@/shared/ffmpeg";

const escaped = (value: string) => value.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");

async function main() {
  const jobId = process.env.SUBTITLE_TEST_JOB_ID;
  if (!jobId) throw new Error("SUBTITLE_TEST_JOB_ID is required");
  const job = loadJob(jobId);
  if (!job.render?.assembled_file || !job.subtitle.segments.length) throw new Error("Rendered test JOB with subtitle segments is required");
  const root = path.join(jobRenderDir(jobId), "preset-tests");
  const fonts = path.join(root, "fonts");
  await fs.mkdir(root, { recursive: true });
  const fontFile = await prepareRenderFont(job.subtitle.settings.font, fonts);
  const fontFamily = await readRenderFontFamily(fontFile);
  const results = [];
  for (const effect of SUBTITLE_EFFECTS) {
    const ass = path.join(root, `${effect}.ass`);
    const output = path.join(root, `${effect}.mp4`);
    const eventCount = await writeAssFile(ass, job.subtitle.segments.slice(0, 2), { ...job.subtitle.settings, effect }, fontFamily);
    await runFfmpeg([
      "-y", "-i", job.render.assembled_file, "-t", "3",
      "-vf", `subtitles=filename='${escaped(ass)}':fontsdir='${escaped(fonts)}'`,
      "-an", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "24", "-pix_fmt", "yuv420p", output,
    ]);
    await runFfmpeg(["-v", "error", "-i", output, "-f", "null", "-"]);
    results.push({ effect, event_count: eventCount, output });
  }
  process.stdout.write(JSON.stringify(results, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
