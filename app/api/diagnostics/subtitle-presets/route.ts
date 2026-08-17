import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import type { SubtitleEffect, SubtitleSegment, SubtitleSettings } from "@/shared/types";
import { SUBTITLE_EFFECTS } from "@/shared/types";
import { writeAssFile } from "@/subtitle/ass";
import { prepareRenderFont, readRenderFontFamily } from "@/render/fonts";
import { runFfmpeg } from "@/shared/ffmpeg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = path.join("/tmp", "instareels-subtitle-diagnostics");
const SAMPLE_TIMES = [0.35, 0.8, 1.2] as const;

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
  {
    segment_id: "SUBTITLE_001",
    text: "이 제품은 생각보다",
    start: 0.05,
    end: 1.4,
    word_timings: [
      { text: "이", start: 0.05, end: 0.2 },
      { text: "제품은", start: 0.22, end: 0.62 },
      { text: "생각보다", start: 0.66, end: 1.3 },
    ],
  },
  {
    segment_id: "SUBTITLE_002",
    text: "훨씬 괜찮아서 실제로",
    start: 1.4,
    end: 2.8,
    word_timings: [
      { text: "훨씬", start: 1.42, end: 1.75 },
      { text: "괜찮아서", start: 1.78, end: 2.32 },
      { text: "실제로", start: 2.36, end: 2.72 },
    ],
  },
  {
    segment_id: "SUBTITLE_003",
    text: "며칠 써보고도 계속",
    start: 2.8,
    end: 4.1,
    word_timings: [
      { text: "며칠", start: 2.82, end: 3.12 },
      { text: "써보고도", start: 3.15, end: 3.68 },
      { text: "계속", start: 3.72, end: 4.02 },
    ],
  },
  {
    segment_id: "SUBTITLE_004",
    text: "사용하고 있습니다.",
    start: 4.1,
    end: 5.4,
    word_timings: [
      { text: "사용하고", start: 4.12, end: 4.72 },
      { text: "있습니다.", start: 4.76, end: 5.32 },
    ],
  },
];

function escaped(value: string): string {
  return value.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

async function ensureDiagnostics() {
  await fs.rm(ROOT, { recursive: true, force: true });
  await fs.mkdir(ROOT, { recursive: true });
  const fontsDir = path.join(ROOT, "fonts");
  const fontFile = await prepareRenderFont("pretendard", fontsDir);
  const fontFamily = await readRenderFontFamily(fontFile);
  const results: Array<Record<string, unknown>> = [];

  for (const effect of SUBTITLE_EFFECTS) {
    const assFile = path.join(ROOT, `${effect}.ass`);
    const mp4File = path.join(ROOT, `${effect}.mp4`);
    const eventCount = await writeAssFile(assFile, segments, { ...settings, effect }, fontFamily);
    const assText = await fs.readFile(assFile, "utf8");
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "color=c=#15131d:s=360x640:r=30:d=5.5",
      "-vf", `subtitles=filename='${escaped(assFile)}':fontsdir='${escaped(fontsDir)}'`,
      "-an", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "22", "-pix_fmt", "yuv420p", mp4File,
    ]);
    await runFfmpeg(["-v", "error", "-i", mp4File, "-f", "null", "-"]);

    const frameHashes: string[] = [];
    const frameBytes: number[] = [];
    for (const seconds of SAMPLE_TIMES) {
      const frameName = `${effect}-${seconds.toFixed(2)}.jpg`;
      const framePath = path.join(ROOT, frameName);
      await runFfmpeg(["-y", "-ss", String(seconds), "-i", mp4File, "-frames:v", "1", "-q:v", "2", framePath]);
      const frame = await fs.readFile(framePath);
      frameHashes.push(crypto.createHash("sha256").update(frame).digest("hex"));
      frameBytes.push(frame.length);
    }

    const layer0 = assText.split("\n").filter((line) => line.startsWith("Dialogue: 0"));
    const layer1 = assText.split("\n").filter((line) => line.startsWith("Dialogue: 1"));
    const layer2 = assText.split("\n").filter((line) => line.startsWith("Dialogue: 2"));
    const layer3 = assText.split("\n").filter((line) => line.startsWith("Dialogue: 3"));
    results.push({
      effect,
      event_count: eventCount,
      layer0_events: layer0.length,
      cursor_events: layer1.length,
      character_overlay_events: layer2.length,
      accent_events: layer3.length,
      h264_render_ok: true,
      sampled_frames: SAMPLE_TIMES.map((seconds, index) => ({
        seconds,
        artifact: `${effect}-${seconds.toFixed(2)}.jpg`,
        bytes: frameBytes[index],
        sha256: frameHashes[index],
      })),
      sampled_frames_change: new Set(frameHashes).size > 1,
      typewriter_has_hidden_suffix: effect !== "typewriter" || assText.includes("\\alpha&HFF&"),
      typewriter_has_cursor_blink: effect !== "typewriter" || (layer1.length > 0 && assText.includes("_cursor_on_") && assText.includes("_cursor_off_")),
      copybook_has_move_blur: effect !== "copybook" || (assText.includes("\\move(") && assText.includes("\\blur2")),
      flat_pop_has_scale_overshoot: effect !== "flat_popout" || (assText.includes("\\fscx25") && assText.includes("\\fscx116")),
      word_zoom_has_active_word_118: effect !== "word_zoom" || assText.includes("\\fscx118"),
    });
  }

  const report = {
    ok: results.every((item) => item.h264_render_ok === true && item.sampled_frames_change === true),
    preset_count: results.length,
    long_sentence: "이 제품은 생각보다 훨씬 괜찮아서 실제로 며칠 써보고도 계속 사용하고 있습니다.",
    elevenlabs_timing_policy: "standard wordTimings preserved; character reveal points derived inside each provider word only",
    font: "pretendard",
    size: 104,
    position: "bottom",
    results,
    generated_at: new Date().toISOString(),
  };
  await fs.writeFile(path.join(ROOT, "report.json"), JSON.stringify(report, null, 2), "utf8");
  return report;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const artifact = url.searchParams.get("artifact");
  if (artifact) {
    if (!/^(typewriter|rushed_typing|copybook|flat_popout|word_zoom|breeze|transparent_gradient|pink_blink|easy_slide)-\d+\.\d+\.jpg$/.test(artifact)) {
      return NextResponse.json({ ok: false, error: "INVALID_ARTIFACT" }, { status: 400 });
    }
    try {
      const bytes = await fs.readFile(path.join(ROOT, artifact));
      return new NextResponse(bytes, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" } });
    } catch {
      return NextResponse.json({ ok: false, error: "ARTIFACT_NOT_READY", message: "먼저 진단 GET을 실행해 주세요." }, { status: 404 });
    }
  }

  try {
    const report = await ensureDiagnostics();
    return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: "SUBTITLE_PRESET_DIAGNOSTIC_FAILED",
      message: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
