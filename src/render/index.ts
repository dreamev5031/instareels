import fs from "node:fs/promises";
import path from "node:path";
import { addLog, failStage, saveJob, startStage, succeedStage } from "@/jobs/store";
import { jobRenderDir, jobRenderScenesDir } from "@/jobs/paths";
import {
  Job,
  JobError,
  PipelineError,
  RENDER_SUBSTAGE_ORDER,
  RenderSubstageName,
  RenderedScene,
  StageState,
} from "@/shared/types";
import { MediaCommandError, probeOutputMedia, runFfmpeg } from "@/shared/ffmpeg";
import { prepareRenderFont, readRenderFontFamily } from "./fonts";
import { writeAssFile } from "@/subtitle/ass";
import { layoutSubtitleText, SUBTITLE_EFFECT_SPEC_BY_ID } from "@/subtitle/spec";
import { bgmStorage } from "@/bgm/storage";

const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1920;
const OUTPUT_FPS = 30;
const COVER_DURATION = 0.1;
const DURATION_TOLERANCE = 0.18;

const AD_LABEL_TEXT = "[광고]";
const AD_LABEL_FONT = "pretendard" as const;
const AD_LABEL_FONT_SIZE = 32;
const AD_LABEL_COLOR = "white@0.55";
const AD_LABEL_MARGIN_X = 40;
const AD_LABEL_MARGIN_Y = 90;

export type RenderProgressCallback = (job: Job) => void;

export function buildAudioMuxArgs({
  videoOnly,
  ttsPath,
  ttsDuration,
  assembled,
  bgmFile,
  bgmVolume = 0,
}: {
  videoOnly: string;
  ttsPath: string;
  ttsDuration: number;
  assembled: string;
  bgmFile?: string;
  bgmVolume?: number;
}): string[] {
  const output = [
    "-c:v", "copy", "-c:a", "aac", "-ar", "24000", "-ac", "1", "-b:a", "144k",
    "-t", String(ttsDuration), "-video_track_timescale", "30000", "-movflags", "+faststart", assembled,
  ];
  if (!bgmFile) {
    return ["-y", "-i", videoOnly, "-i", ttsPath, "-map", "0:v:0", "-map", "1:a:0", ...output];
  }
  const volume = Math.min(1, Math.max(0, bgmVolume));
  return [
    "-y", "-i", videoOnly, "-i", ttsPath, "-stream_loop", "-1", "-i", bgmFile,
    "-filter_complex",
    `[1:a]volume=1.0[tts];[2:a]volume=${volume},atrim=duration=${ttsDuration},asetpts=PTS-STARTPTS[bgm];` +
      "[tts][bgm]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]",
    "-map", "0:v:0", "-map", "[aout]", ...output,
  ];
}

type RenderErrorCode = Extract<
  PipelineError["code"],
  | "RENDER_VALIDATE_REQUIRED"
  | "RENDER_ALREADY_RUNNING"
  | "RENDER_PLAN_INVALID"
  | "RENDER_SOURCE_MISSING"
  | "SOURCE_DECODE_FAILED"
  | "VIDEO_ASSEMBLY_FAILED"
  | "SUBTITLE_INVALID_SETTINGS"
  | "SUBTITLE_TIMING_FAILED"
  | "SUBTITLE_FONT_NOT_FOUND"
  | "SUBTITLE_ASS_GENERATION_FAILED"
  | "SUBTITLE_BURN_FAILED"
  | "FONT_PREPARE_FAILED"
  | "COVER_RENDER_FAILED"
  | "AD_OVERLAY_FAILED"
  | "FINAL_CONCAT_FAILED"
  | "RENDER_OUTPUT_INVALID"
  | "RENDER_DECODE_FAILED"
>;

class RenderStepError extends Error {
  constructor(
    readonly substage: RenderSubstageName,
    readonly code: RenderErrorCode,
    message: string,
    readonly detail: {
      scene_id?: string;
      source_id?: string;
      clip_id?: string;
      file_path?: string;
      ffmpeg_command_summary?: string;
      stderr?: string;
      [key: string]: unknown;
    } = {},
  ) {
    super(message);
    this.name = "RenderStepError";
  }
}

function blankSubstages(): Record<RenderSubstageName, StageState> {
  return Object.fromEntries(RENDER_SUBSTAGE_ORDER.map((name) => [name, { status: "PENDING" }])) as Record<
    RenderSubstageName,
    StageState
  >;
}

function commandSummary(args: string[]): string {
  return `ffmpeg ${args.map((arg) => (arg.includes(" ") ? `"${arg}"` : arg)).join(" ")}`.slice(0, 4000);
}

function stderrTail(error: unknown): string {
  if (error instanceof MediaCommandError) return error.stderr.slice(-4000);
  return error instanceof Error ? error.message.slice(-4000) : String(error).slice(-4000);
}

function startSubstage(job: Job, name: RenderSubstageName, onProgress?: RenderProgressCallback) {
  job.render!.substages[name] = { status: "RUNNING", startedAt: new Date().toISOString() };
  addLog(job, "RENDER", "info", `${name} 시작`, { substage: name });
  saveJob(job);
  onProgress?.(job);
}

function succeedSubstage(job: Job, name: RenderSubstageName, onProgress?: RenderProgressCallback) {
  const previous = job.render!.substages[name];
  job.render!.substages[name] = {
    status: "SUCCESS",
    startedAt: previous.startedAt,
    finishedAt: new Date().toISOString(),
  };
  addLog(job, "RENDER", "info", `${name} 완료`, { substage: name });
  saveJob(job);
  onProgress?.(job);
}

function skipSubstage(job: Job, name: RenderSubstageName, onProgress?: RenderProgressCallback) {
  const now = new Date().toISOString();
  job.render!.substages[name] = { status: "SKIPPED", startedAt: now, finishedAt: now, skipReason: "DISABLED_BY_USER" };
  addLog(job, "RENDER", "info", `${name} 건너뜀`, { substage: name, reason: "DISABLED_BY_USER" });
  saveJob(job);
  onProgress?.(job);
}

function failSubstage(job: Job, error: RenderStepError) {
  const previous = job.render!.substages[error.substage];
  const jobError: JobError = {
    stage: "RENDER",
    error_code: error.code,
    message: error.message,
    scene_id: error.detail.scene_id,
    source_id: error.detail.source_id,
    clip_id: error.detail.clip_id,
    context: { substage: error.substage, ...error.detail },
    timestamp: new Date().toISOString(),
  };
  job.render!.substages[error.substage] = {
    status: "FAILED",
    startedAt: previous.startedAt,
    finishedAt: new Date().toISOString(),
    error: jobError,
  };
  return jobError;
}

function wrapText(text: string, maxCharacters: number): string[] {
  const paragraphs = text.trim() ? text.trim().split(/\r?\n/) : [];
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    let current = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (Array.from(candidate).length <= maxCharacters) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      const characters = Array.from(word);
      while (characters.length > maxCharacters) lines.push(characters.splice(0, maxCharacters).join(""));
      current = characters.join("");
    }
    if (current) lines.push(current);
  }
  return lines;
}

function escapeFilterPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

async function addTextFilters(
  job: Job,
  renderDir: string,
  mainFont: string,
  subFont: string,
): Promise<string[]> {
  const mainLines = wrapText(job.cover.main_text, 11);
  const subLines = wrapText(job.cover.sub_text, 18);
  const mainLineHeight = 116;
  const subLineHeight = 72;
  const gap = mainLines.length && subLines.length ? 36 : 0;
  const blockHeight = mainLines.length * mainLineHeight + gap + subLines.length * subLineHeight;
  const blockTop = job.cover.vertical_position === "top"
    ? 230
    : job.cover.vertical_position === "bottom"
      ? OUTPUT_HEIGHT - 230 - blockHeight
      : (OUTPUT_HEIGHT - blockHeight) / 2;
  const color = `0x${job.cover.text_color.slice(1)}`;
  const style = [
    job.cover.shadow_enabled ? "shadowcolor=black@0.75:shadowx=5:shadowy=7" : "",
    job.cover.stroke_enabled ? "borderw=5:bordercolor=black@0.9" : "",
  ].filter(Boolean).join(":");
  const filters: string[] = [];
  let y = Math.max(80, blockTop);

  async function append(lines: string[], fontPath: string, fontSize: number, lineHeight: number, prefix: string) {
    for (let index = 0; index < lines.length; index += 1) {
      const textFile = path.join(renderDir, `${prefix}-${index + 1}.txt`);
      await fs.writeFile(textFile, lines[index]!, "utf8");
      filters.push(
        `drawtext=fontfile='${escapeFilterPath(fontPath)}':textfile='${escapeFilterPath(textFile)}'` +
        `:fontcolor=${color}:fontsize=${fontSize}:x=(w-text_w)/2:y=${Math.round(y)}` +
        (style ? `:${style}` : ""),
      );
      y += lineHeight;
    }
  }

  await append(mainLines, mainFont, 92, mainLineHeight, "cover-main");
  y += gap;
  await append(subLines, subFont, 54, subLineHeight, "cover-sub");
  return filters;
}

async function renderVideoAssembly(job: Job, onProgress?: RenderProgressCallback) {
  startSubstage(job, "VIDEO_ASSEMBLY", onProgress);
  const renderDir = jobRenderDir(job.job_id);
  const scenesDir = jobRenderScenesDir(job.job_id);
  await fs.rm(scenesDir, { recursive: true, force: true });
  await fs.mkdir(scenesDir, { recursive: true });
  const renderedScenes: RenderedScene[] = [];

  for (const scene of job.scenes) {
    const source = job.sources.find((candidate) => candidate.source_id === scene.source_id);
    if (!source) {
      throw new RenderStepError("VIDEO_ASSEMBLY", "RENDER_SOURCE_MISSING", `${scene.scene_id}의 원본 영상을 찾을 수 없습니다.`, {
        scene_id: scene.scene_id, source_id: scene.source_id, clip_id: scene.clip_id,
      });
    }
    try {
      await fs.access(source.file);
    } catch {
      throw new RenderStepError("VIDEO_ASSEMBLY", "RENDER_SOURCE_MISSING", `${scene.scene_id}의 원본 파일이 없습니다.`, {
        scene_id: scene.scene_id, source_id: scene.source_id, clip_id: scene.clip_id, file_path: source.file,
        ffmpeg_command_summary: "not started: source file missing",
        stderr: "ENOENT: source file does not exist",
      });
    }

    const sceneFile = path.join(scenesDir, `${scene.scene_id}.mp4`);
    const args = [
      "-y", "-ss", String(scene.source_start), "-i", source.file, "-t", String(scene.duration), "-an",
      "-vf", `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=increase,crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT},fps=${OUTPUT_FPS},setsar=1,format=yuv420p`,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
      "-video_track_timescale", "30000", "-movflags", "+faststart", sceneFile,
    ];
    try {
      await runFfmpeg(args);
    } catch (caught) {
      throw new RenderStepError("VIDEO_ASSEMBLY", "SOURCE_DECODE_FAILED", `${scene.scene_id} 영상 구간을 디코딩하지 못했습니다.`, {
        scene_id: scene.scene_id,
        source_id: scene.source_id,
        clip_id: scene.clip_id,
        source_start: scene.source_start,
        source_end: scene.source_end,
        file_path: source.file,
        ffmpeg_command_summary: commandSummary(args),
        stderr: stderrTail(caught),
      });
    }
    renderedScenes.push({ ...scene, file: sceneFile });
    addLog(job, "RENDER", "info", `${scene.scene_id} 렌더 완료`, {
      substage: "VIDEO_ASSEMBLY", scene_id: scene.scene_id, source_id: scene.source_id,
      clip_id: scene.clip_id, source_start: scene.source_start, source_end: scene.source_end,
    });
  }

  const concatList = path.join(renderDir, "scenes.txt");
  await fs.writeFile(concatList, renderedScenes.map((scene) => `file '${path.relative(renderDir, scene.file).replace(/\\/g, "/")}'`).join("\n"), "utf8");
  const videoOnly = path.join(renderDir, "assembled-video.mp4");
  const concatArgs = ["-y", "-f", "concat", "-safe", "0", "-i", concatList, "-c", "copy", "-video_track_timescale", "30000", videoOnly];
  try {
    await runFfmpeg(concatArgs);
  } catch (caught) {
    throw new RenderStepError("VIDEO_ASSEMBLY", "VIDEO_ASSEMBLY_FAILED", "렌더된 scene을 본영상으로 조립하지 못했습니다.", {
      file_path: concatList, ffmpeg_command_summary: commandSummary(concatArgs), stderr: stderrTail(caught),
    });
  }

  const assembled = path.join(renderDir, "assembled.mp4");
  let muxArgs: string[];
  if (job.bgm.bgmEnabled) {
    if (!job.bgm.bgmId) {
      throw new RenderStepError("VIDEO_ASSEMBLY", "VIDEO_ASSEMBLY_FAILED", "선택한 BGM 정보가 없습니다.", {
        bgm_enabled: true,
      });
    }
    const bgmFile = path.join(renderDir, "bgm.mp3");
    try {
      if (!await bgmStorage.downloadTrack(job.bgm.bgmId, bgmFile)) {
        throw new Error("BGM_NOT_FOUND");
      }
    } catch (caught) {
      throw new RenderStepError("VIDEO_ASSEMBLY", "VIDEO_ASSEMBLY_FAILED", "선택한 BGM을 Bucket에서 내려받지 못했습니다.", {
        bgm_id: job.bgm.bgmId,
        bgm_name: job.bgm.bgmName,
        stderr: stderrTail(caught),
      });
    }
    const bgmVolume = Math.min(1, Math.max(0, job.bgm.bgmVolume));
    muxArgs = buildAudioMuxArgs({
      videoOnly,
      ttsPath: job.tts!.audio_path,
      ttsDuration: job.tts!.duration,
      assembled,
      bgmFile,
      bgmVolume,
    });
    addLog(job, "RENDER", "info", "TTS와 BGM 오디오 mix 준비", {
      substage: "VIDEO_ASSEMBLY",
      tts_volume: 1,
      bgm_id: job.bgm.bgmId,
      bgm_name: job.bgm.bgmName,
      bgm_volume: bgmVolume,
    });
  } else {
    muxArgs = buildAudioMuxArgs({
      videoOnly,
      ttsPath: job.tts!.audio_path,
      ttsDuration: job.tts!.duration,
      assembled,
    });
  }
  try {
    await runFfmpeg(muxArgs);
  } catch (caught) {
    throw new RenderStepError("VIDEO_ASSEMBLY", "VIDEO_ASSEMBLY_FAILED", "본영상에 TTS 오디오를 결합하지 못했습니다.", {
      file_path: job.tts!.audio_path, ffmpeg_command_summary: commandSummary(muxArgs), stderr: stderrTail(caught),
    });
  }

  job.render!.scene_plan = renderedScenes;
  job.render!.assembled_file = assembled;
  job.render!.body_duration = (await probeOutputMedia(assembled)).duration;
  succeedSubstage(job, "VIDEO_ASSEMBLY", onProgress);
}

async function renderCover(job: Job, onProgress?: RenderProgressCallback) {
  startSubstage(job, "COVER_RENDER", onProgress);
  const renderDir = jobRenderDir(job.job_id);
  const fontsDir = path.join(renderDir, "fonts");
  let mainFont: string;
  let subFont: string;
  try {
    mainFont = await prepareRenderFont(job.cover.main_font, fontsDir);
    subFont = job.cover.use_same_font
      ? mainFont
      : await prepareRenderFont(job.cover.sub_font, fontsDir);
  } catch (caught) {
    throw new RenderStepError("COVER_RENDER", "FONT_PREPARE_FAILED", "선택한 앞표지 폰트를 준비하지 못했습니다.", {
      main_font: job.cover.main_font, sub_font: job.cover.sub_font, stderr: stderrTail(caught),
    });
  }
  const textFilters = await addTextFilters(job, renderDir, mainFont, subFont);
  const coverFile = path.join(renderDir, "cover.mp4");
  const filter = [
    `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=increase`,
    `crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}`,
    ...textFilters,
    `fps=${OUTPUT_FPS}`,
    "setsar=1",
    "format=yuv420p",
  ].join(",");
  const args = [
    "-y", "-loop", "1", "-i", job.cover.image!.file,
    "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", String(COVER_DURATION),
    "-vf", filter, "-r", String(OUTPUT_FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "24000", "-ac", "1",
    "-video_track_timescale", "30000", "-shortest", "-movflags", "+faststart", coverFile,
  ];
  try {
    await runFfmpeg(args);
  } catch (caught) {
    throw new RenderStepError("COVER_RENDER", "COVER_RENDER_FAILED", "앞표지 0.1초 클립 생성에 실패했습니다.", {
      file_path: job.cover.image!.file, ffmpeg_command_summary: commandSummary(args), stderr: stderrTail(caught),
      main_font: job.cover.main_font, sub_font: job.cover.sub_font,
      vertical_position: job.cover.vertical_position,
    });
  }
  job.render!.cover_file = coverFile;
  job.render!.cover_duration = (await probeOutputMedia(coverFile)).duration;
  succeedSubstage(job, "COVER_RENDER", onProgress);
}

async function generateAndBurnSubtitles(job: Job, onProgress?: RenderProgressCallback) {
  if (!job.subtitle.settings.enabled) {
    skipSubstage(job, "SUBTITLE_GENERATION", onProgress);
    skipSubstage(job, "SUBTITLE_BURN", onProgress);
    job.subtitle = { ...job.subtitle, status: "SUCCESS", ass_file: undefined, burned_file: job.render!.assembled_file, event_count: 0, burn_verified: true };
    saveJob(job);
    return;
  }
  if (job.subtitle.status !== "SUCCESS" || job.subtitle.segments.length === 0) {
    throw new RenderStepError("SUBTITLE_GENERATION", "SUBTITLE_TIMING_FAILED", "확정된 자막 segment가 없습니다. 자막 설정을 먼저 저장해 주세요.", {
      subtitle_status: job.subtitle.status,
      segment_count: job.subtitle.segments.length,
    });
  }

  startSubstage(job, "SUBTITLE_GENERATION", onProgress);
  const renderDir = jobRenderDir(job.job_id);
  const fontsDir = path.join(renderDir, "fonts");
  let subtitleFontFamily: string;
  try {
    const subtitleFontFile = await prepareRenderFont(job.subtitle.settings.font, fontsDir);
    subtitleFontFamily = await readRenderFontFamily(subtitleFontFile);
  } catch (caught) {
    throw new RenderStepError("SUBTITLE_GENERATION", "SUBTITLE_FONT_NOT_FOUND", "선택한 자막 폰트를 준비하지 못했습니다.", {
      font: job.subtitle.settings.font,
      file_path: fontsDir,
      stderr: stderrTail(caught),
    });
  }
  const assFile = path.join(renderDir, "subtitles.ass");
  let eventCount = 0;
  try {
    eventCount = await writeAssFile(assFile, job.subtitle.segments, job.subtitle.settings, subtitleFontFamily);
    if (eventCount <= 0) throw new Error("ASS Dialogue event가 0개입니다.");
  } catch (caught) {
    throw new RenderStepError("SUBTITLE_GENERATION", "SUBTITLE_ASS_GENERATION_FAILED", "ASS 자막 생성에 실패했습니다.", {
      file_path: assFile,
      segment_count: job.subtitle.segments.length,
      effect: job.subtitle.settings.effect,
      stderr: stderrTail(caught),
    });
  }
  Object.assign(job.subtitle, { ass_file: assFile, event_count: eventCount });
  addLog(job, "RENDER", "info", `ASS 자막 생성 완료: ${job.subtitle.segments.length}개 segment / ${eventCount}개 event`, {
    substage: "SUBTITLE_GENERATION",
    ass_file: assFile,
    font: job.subtitle.settings.font,
    font_family: subtitleFontFamily,
    effect: job.subtitle.settings.effect,
    effect_mode: SUBTITLE_EFFECT_SPEC_BY_ID[job.subtitle.settings.effect].mode,
    effect_source: "COMMON_EFFECT_SPEC",
    line_breaks: job.subtitle.segments.map((segment) => ({
      segment_id: segment.segment_id,
      before: segment.text,
      lines: layoutSubtitleText(segment.text, job.subtitle.settings.size).lines,
    })),
  });
  succeedSubstage(job, "SUBTITLE_GENERATION", onProgress);

  startSubstage(job, "SUBTITLE_BURN", onProgress);
  const burnedFile = path.join(renderDir, "subtitled.mp4");
  const filter = `subtitles=filename='${escapeFilterPath(assFile)}':fontsdir='${escapeFilterPath(fontsDir)}'`;
  const args = [
    "-y", "-i", job.render!.assembled_file!, "-vf", filter,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
    "-c:a", "copy", "-video_track_timescale", "30000", "-movflags", "+faststart", burnedFile,
  ];
  try {
    await runFfmpeg(args);
  } catch (caught) {
    throw new RenderStepError("SUBTITLE_BURN", "SUBTITLE_BURN_FAILED", "FFmpeg/libass 자막 burn-in에 실패했습니다.", {
      font: job.subtitle.settings.font,
      ass_file: assFile,
      file_path: burnedFile,
      ffmpeg_command_summary: commandSummary(args),
      stderr: stderrTail(caught),
    });
  }

  const sampleTime = Math.max(0.05, Math.min(job.tts!.duration - 0.05, (job.subtitle.segments[0]!.start + job.subtitle.segments[0]!.end) / 2));
  let similarity = 1;
  try {
    const { stderr } = await runFfmpeg([
      "-v", "info", "-ss", String(sampleTime), "-i", job.render!.assembled_file!,
      "-ss", String(sampleTime), "-i", burnedFile,
      "-filter_complex", "[0:v][1:v]ssim",
      "-frames:v", "1", "-f", "null", "-",
    ]);
    const match = stderr.match(/All:([0-9.]+)/);
    similarity = match ? Number.parseFloat(match[1]!) : 1;
  } catch (caught) {
    throw new RenderStepError("SUBTITLE_BURN", "SUBTITLE_BURN_FAILED", "자막 burn-in 프레임 검증에 실패했습니다.", {
      file_path: burnedFile, stderr: stderrTail(caught), sample_time: sampleTime,
    });
  }
  if (similarity >= 0.9998) {
    throw new RenderStepError("SUBTITLE_BURN", "SUBTITLE_BURN_FAILED", "자막이 실제 영상 픽셀에 반영되지 않았습니다.", {
      file_path: burnedFile, ass_file: assFile, sample_time: sampleTime, frame_ssim: similarity,
    });
  }
  Object.assign(job.subtitle, { burned_file: burnedFile, burn_verified: true });
  addLog(job, "RENDER", "info", "자막 burn-in 검증 통과", { substage: "SUBTITLE_BURN", frame_ssim: similarity, sample_time: sampleTime });
  succeedSubstage(job, "SUBTITLE_BURN", onProgress);
}

async function applyAdOverlay(job: Job, onProgress?: RenderProgressCallback) {
  const bodyFile = job.subtitle.burned_file ?? job.render!.assembled_file!;
  if (!job.ad_label_enabled) {
    skipSubstage(job, "AD_OVERLAY", onProgress);
    job.render!.body_file = bodyFile;
    saveJob(job);
    return;
  }

  startSubstage(job, "AD_OVERLAY", onProgress);
  const renderDir = jobRenderDir(job.job_id);
  const fontsDir = path.join(renderDir, "fonts");
  let fontPath: string;
  try {
    fontPath = await prepareRenderFont(AD_LABEL_FONT, fontsDir);
  } catch (caught) {
    throw new RenderStepError("AD_OVERLAY", "AD_OVERLAY_FAILED", "[광고] 표시용 폰트를 준비하지 못했습니다.", {
      font: AD_LABEL_FONT, stderr: stderrTail(caught),
    });
  }
  const textFile = path.join(renderDir, "ad-label.txt");
  await fs.writeFile(textFile, AD_LABEL_TEXT, "utf8");
  const outputFile = path.join(renderDir, "ad-overlay.mp4");
  const filter =
    `drawtext=fontfile='${escapeFilterPath(fontPath)}':textfile='${escapeFilterPath(textFile)}'` +
    `:fontcolor=${AD_LABEL_COLOR}:fontsize=${AD_LABEL_FONT_SIZE}:x=w-text_w-${AD_LABEL_MARGIN_X}:y=${AD_LABEL_MARGIN_Y}`;
  const args = [
    "-y", "-i", bodyFile, "-vf", filter,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
    "-c:a", "copy", "-video_track_timescale", "30000", "-movflags", "+faststart", outputFile,
  ];
  try {
    await runFfmpeg(args);
  } catch (caught) {
    throw new RenderStepError("AD_OVERLAY", "AD_OVERLAY_FAILED", "우측 상단 [광고] 표시 합성에 실패했습니다.", {
      font: AD_LABEL_FONT,
      file_path: outputFile,
      ffmpeg_command_summary: commandSummary(args),
      stderr: stderrTail(caught),
    });
  }
  job.render!.body_file = outputFile;
  addLog(job, "RENDER", "info", "[광고] 표시 합성 완료", {
    substage: "AD_OVERLAY",
    font: AD_LABEL_FONT,
    font_size: AD_LABEL_FONT_SIZE,
    color: AD_LABEL_COLOR,
    margin_x: AD_LABEL_MARGIN_X,
    margin_y: AD_LABEL_MARGIN_Y,
  });
  succeedSubstage(job, "AD_OVERLAY", onProgress);
}

async function concatFinal(job: Job, onProgress?: RenderProgressCallback) {
  startSubstage(job, "FINAL_CONCAT", onProgress);
  const renderDir = jobRenderDir(job.job_id);
  const finalFile = path.join(renderDir, "final.mp4");
  const args = [
    "-y", "-i", job.render!.cover_file!, "-i", job.render!.body_file!,
    "-filter_complex",
    "[0:v]setpts=PTS-STARTPTS[v0];[0:a]asetpts=PTS-STARTPTS[a0];" +
      "[1:v]setpts=PTS-STARTPTS[v1];[1:a]asetpts=PTS-STARTPTS[a1];" +
      "[v0][a0][v1][a1]concat=n=2:v=1:a=1[vout][aout]",
    "-map", "[vout]", "-map", "[aout]", "-r", String(OUTPUT_FPS),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-ar", "24000", "-ac", "1", "-b:a", "144k",
    "-video_track_timescale", "30000", "-movflags", "+faststart", finalFile,
  ];
  try {
    await runFfmpeg(args);
  } catch (caught) {
    throw new RenderStepError("FINAL_CONCAT", "FINAL_CONCAT_FAILED", "앞표지와 본영상을 최종 MP4로 합치지 못했습니다.", {
      file_path: finalFile, ffmpeg_command_summary: commandSummary(args), stderr: stderrTail(caught),
    });
  }
  job.render!.final_file = finalFile;
  job.render!.final_media_path = `/api/media/${job.job_id}/final`;
  succeedSubstage(job, "FINAL_CONCAT", onProgress);
}

async function firstFrameSimilarity(coverFile: string, finalFile: string): Promise<number> {
  const { stderr } = await runFfmpeg([
    "-v", "info", "-i", coverFile, "-i", finalFile,
    "-filter_complex", "[0:v]select=eq(n\\,0),setpts=PTS-STARTPTS[a];[1:v]select=eq(n\\,0),setpts=PTS-STARTPTS[b];[a][b]ssim",
    "-frames:v", "1", "-f", "null", "-",
  ]);
  const match = stderr.match(/All:([0-9.]+)/);
  return match ? Number.parseFloat(match[1]!) : 0;
}

async function validateOutput(job: Job, onProgress?: RenderProgressCallback) {
  startSubstage(job, "OUTPUT_VALIDATE", onProgress);
  const finalFile = job.render!.final_file!;
  let stat;
  try {
    stat = await fs.stat(finalFile);
  } catch {
    throw new RenderStepError("OUTPUT_VALIDATE", "RENDER_OUTPUT_INVALID", "최종 MP4 파일이 생성되지 않았습니다.", { file_path: finalFile });
  }
  const probe = await probeOutputMedia(finalFile);
  const expectedDuration = job.tts!.duration + COVER_DURATION;
  const checks = {
    non_empty: stat.size > 0,
    video_stream: probe.hasVideo,
    audio_stream: probe.hasAudio,
    resolution: probe.width === OUTPUT_WIDTH && probe.height === OUTPUT_HEIGHT,
    video_codec: probe.videoCodec === "h264",
    audio_codec: probe.audioCodec === "aac",
    fps: Math.abs(probe.fps - OUTPUT_FPS) <= 0.05,
    duration: Math.abs(probe.duration - expectedDuration) <= DURATION_TOLERANCE,
  };
  if (Object.values(checks).some((passed) => !passed)) {
    throw new RenderStepError("OUTPUT_VALIDATE", "RENDER_OUTPUT_INVALID", "최종 MP4 출력 규격 검증에 실패했습니다.", {
      file_path: finalFile, checks, probe, expected_duration: expectedDuration,
    });
  }

  const firstFrameSsim = await firstFrameSimilarity(job.render!.cover_file!, finalFile);
  const firstFrameMatchesCover = firstFrameSsim >= 0.95;
  if (!firstFrameMatchesCover) {
    throw new RenderStepError("OUTPUT_VALIDATE", "RENDER_OUTPUT_INVALID", "최종 영상 첫 프레임에 앞표지가 적용되지 않았습니다.", {
      file_path: finalFile, first_frame_matches_cover: false, first_frame_ssim: firstFrameSsim,
    });
  }
  const decodeArgs = ["-v", "error", "-i", finalFile, "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"];
  try {
    await runFfmpeg(decodeArgs);
  } catch (caught) {
    throw new RenderStepError("OUTPUT_VALIDATE", "RENDER_DECODE_FAILED", "최종 MP4 전체 디코딩 검사에 실패했습니다.", {
      file_path: finalFile, ffmpeg_command_summary: commandSummary(decodeArgs), stderr: stderrTail(caught),
    });
  }

  Object.assign(job.render!, {
    final_duration: probe.duration,
    width: probe.width,
    height: probe.height,
    fps: probe.fps,
    video_codec: probe.videoCodec,
    audio_codec: probe.audioCodec,
    file_size: stat.size,
    first_frame_matches_cover: true,
    decode_verified: true,
  });
  addLog(job, "RENDER", "info", "최종 MP4 검증 통과", { ...checks, file_size: stat.size, duration: probe.duration });
  succeedSubstage(job, "OUTPUT_VALIDATE", onProgress);
}

export async function runRenderStage(job: Job, onProgress?: RenderProgressCallback): Promise<void> {
  if (job.stages.RENDER.status === "RUNNING") {
    throw new PipelineError("RENDER", "RENDER_ALREADY_RUNNING", "이미 영상 렌더가 진행 중입니다.");
  }
  if (job.stages.VALIDATE.status !== "SUCCESS" || job.validation?.status !== "PASS") {
    throw new PipelineError("RENDER", "RENDER_VALIDATE_REQUIRED", "VALIDATE PASS 상태의 JOB만 렌더할 수 있습니다.", {
      context: { validate_stage: job.stages.VALIDATE.status, validation: job.validation?.status ?? null },
    });
  }
  if (!job.tts?.audio_path || !job.cover.image?.file || job.scenes.length === 0) {
    throw new PipelineError("RENDER", "RENDER_PLAN_INVALID", "TTS, 앞표지, scene 렌더 계획이 모두 필요합니다.");
  }
  if (job.subtitle.settings.enabled && (job.subtitle.status !== "SUCCESS" || job.subtitle.segments.length === 0)) {
    throw new PipelineError("RENDER", "SUBTITLE_TIMING_FAILED", "자막 설정을 저장해 확정된 segment를 만든 뒤 렌더해 주세요.", {
      context: { subtitle_status: job.subtitle.status, segment_count: job.subtitle.segments.length },
    });
  }

  startStage(job, "RENDER");
  job.render = { status: "RUNNING", substages: blankSubstages(), scene_plan: [] };
  saveJob(job);
  onProgress?.(job);

  try {
    await fs.mkdir(jobRenderDir(job.job_id), { recursive: true });
    await renderVideoAssembly(job, onProgress);
    await generateAndBurnSubtitles(job, onProgress);
    await applyAdOverlay(job, onProgress);
    await renderCover(job, onProgress);
    await concatFinal(job, onProgress);
    await validateOutput(job, onProgress);
    job.render.status = "SUCCESS";
    succeedStage(job, "RENDER");
    saveJob(job);
    onProgress?.(job);
  } catch (caught) {
    const error = caught instanceof RenderStepError
      ? caught
      : new RenderStepError("OUTPUT_VALIDATE", "RENDER_OUTPUT_INVALID", caught instanceof Error ? caught.message : "렌더 중 알 수 없는 오류가 발생했습니다.", {
          stderr: stderrTail(caught),
        });
    const jobError = failSubstage(job, error);
    if (error.substage === "SUBTITLE_GENERATION" || error.substage === "SUBTITLE_BURN") {
      job.subtitle.status = "FAILED";
      job.subtitle.error = jobError;
    }
    job.render.status = "FAILED";
    failStage(job, "RENDER", jobError);
    saveJob(job);
    onProgress?.(job);
    throw new PipelineError("RENDER", error.code, error.message, {
      scene_id: error.detail.scene_id,
      source_id: error.detail.source_id,
      clip_id: error.detail.clip_id,
      context: jobError.context,
    });
  }
}
