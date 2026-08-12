import { spawn } from "node:child_process";
import path from "node:path";

const FFMPEG_BIN = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE_BIN = process.env.FFPROBE_PATH || "ffprobe";

export class MediaCommandError extends Error {
  bin: string;
  args: string[];
  stderr: string;
  exitCode: number | null;

  constructor(bin: string, args: string[], stderr: string, exitCode: number | null, cause?: Error) {
    super(cause?.message ?? `${bin} exited with code ${exitCode}: ${stderr.slice(-2000)}`);
    this.name = "MediaCommandError";
    this.bin = bin;
    this.args = args;
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

function run(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", (err) => reject(new MediaCommandError(bin, args, stderr, null, err)));
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new MediaCommandError(bin, args, stderr, code));
    });
  });
}

export function runFfmpeg(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return run(FFMPEG_BIN, args);
}

export function runFfprobe(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return run(FFPROBE_BIN, args);
}

/** Confirms a binary (ffmpeg/ffprobe) is on PATH and runnable; returns its
 *  version line. Used by the diagnostics endpoint, not the pipeline itself. */
export async function checkBinaryVersion(bin: "ffmpeg" | "ffprobe"): Promise<string> {
  const target = bin === "ffmpeg" ? FFMPEG_BIN : FFPROBE_BIN;
  const { stdout } = await run(target, ["-version"]);
  return stdout.split("\n")[0]?.trim() ?? "";
}

export interface ProbeResult {
  duration: number;
  width: number;
  height: number;
  fps: number;
  codecName: string;
  containerFormat: string;
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
  if (!videoStream) throw new Error("ffprobe 결과에 비디오 스트림이 없습니다.");
  const duration = parseFloat(data.format?.duration ?? videoStream?.duration ?? "0") || 0;
  let fps = 0;
  if (videoStream?.avg_frame_rate && videoStream.avg_frame_rate !== "0/0") {
    const [num, den] = videoStream.avg_frame_rate.split("/").map(Number);
    fps = den ? num / den : num;
  }
  const result = {
    duration,
    width: videoStream?.width ?? 0,
    height: videoStream?.height ?? 0,
    fps: Math.round(fps * 100) / 100,
    codecName: String(videoStream.codec_name ?? ""),
    containerFormat: String(data.format?.format_name ?? ""),
  };
  if (result.duration <= 0 || result.width <= 0 || result.height <= 0 || !result.codecName) {
    throw new Error("ffprobe가 유효한 영상 길이·해상도·코덱을 확인하지 못했습니다.");
  }
  return result;
}

export interface OutputProbeResult {
  duration: number;
  size: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec: string;
  hasVideo: boolean;
  hasAudio: boolean;
}

export async function probeOutputMedia(filePath: string): Promise<OutputProbeResult> {
  const { stdout } = await runFfprobe([
    "-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath,
  ]);
  const data = JSON.parse(stdout);
  const streams = data.streams ?? [];
  const video = streams.find((stream: { codec_type?: string }) => stream.codec_type === "video");
  const audio = streams.find((stream: { codec_type?: string }) => stream.codec_type === "audio");
  let fps = 0;
  if (video?.avg_frame_rate && video.avg_frame_rate !== "0/0") {
    const [num = 0, den = 0] = String(video.avg_frame_rate).split("/").map(Number);
    fps = den ? num / den : num;
  }
  return {
    duration: Number.parseFloat(data.format?.duration ?? video?.duration ?? "0") || 0,
    size: Number.parseInt(data.format?.size ?? "0", 10) || 0,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    fps: Math.round(fps * 100) / 100,
    videoCodec: String(video?.codec_name ?? ""),
    audioCodec: String(audio?.codec_name ?? ""),
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
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
