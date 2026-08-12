import { spawn } from "node:child_process";
import path from "node:path";

const FFMPEG_BIN = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE_BIN = process.env.FFPROBE_PATH || "ffprobe";

function run(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${bin} exited with code ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

export interface ProbeResult {
  duration: number;
  width: number;
  height: number;
  fps: number;
}

export async function probeMedia(filePath: string): Promise<ProbeResult> {
  const { stdout } = await run(FFPROBE_BIN, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);
  const data = JSON.parse(stdout);
  const videoStream = (data.streams || []).find((s: any) => s.codec_type === "video");
  const duration = parseFloat(data.format?.duration ?? videoStream?.duration ?? "0") || 0;
  let fps = 0;
  if (videoStream?.avg_frame_rate && videoStream.avg_frame_rate !== "0/0") {
    const [num, den] = videoStream.avg_frame_rate.split("/").map(Number);
    fps = den ? num / den : num;
  }
  return {
    duration,
    width: videoStream?.width ?? 0,
    height: videoStream?.height ?? 0,
    fps: Math.round(fps * 100) / 100,
  };
}

export async function probeAudioDuration(filePath: string): Promise<number> {
  const { stdout } = await run(FFPROBE_BIN, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    filePath,
  ]);
  const data = JSON.parse(stdout);
  return parseFloat(data.format?.duration ?? "0") || 0;
}

export async function extractFrames(
  videoPath: string,
  outDir: string,
  intervalSeconds: number
): Promise<string[]> {
  const fps = 1 / intervalSeconds;
  const pattern = path.join(outDir, "frame_%05d.jpg");
  await run(FFMPEG_BIN, [
    "-y",
    "-i",
    videoPath,
    "-vf",
    `fps=${fps}`,
    "-q:v",
    "3",
    pattern,
  ]);
  const fs = await import("node:fs/promises");
  const files = (await fs.readdir(outDir))
    .filter((f) => f.startsWith("frame_") && f.endsWith(".jpg"))
    .sort();
  return files.map((f) => path.join(outDir, f));
}

export async function extractThumbnail(videoPath: string, outFile: string): Promise<void> {
  await run(FFMPEG_BIN, [
    "-y",
    "-ss",
    "0.5",
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-q:v",
    "4",
    outFile,
  ]);
}
