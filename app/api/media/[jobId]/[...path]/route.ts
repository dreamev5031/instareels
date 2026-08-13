import fs from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { NextResponse } from "next/server";
import { jobExists, loadJob } from "@/jobs/store";

export const runtime = "nodejs";

const CONTENT_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".m4v": "video/mp4",
};

/** Parses a single-range "bytes=start-end" Range header (the only form any
 *  real client sends for video). Returns null for anything else, which the
 *  caller treats as "ignore the header, serve the whole file" per the HTTP
 *  spec rather than as an error. */
function parseRange(rangeHeader: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;
  const [, startStr, endStr] = match;
  if (!startStr && !endStr) return null;

  let start: number;
  let end: number;
  if (!startStr) {
    // Suffix form "bytes=-N": the last N bytes of the file.
    const suffixLength = Number(endStr);
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(startStr);
    end = endStr ? Number(endStr) : size - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start < 0 || end >= size) return null;
  return { start, end };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ jobId: string; path: string[] }> }
) {
  const { jobId, path: segments } = await params;
  if (!jobExists(jobId)) {
    return NextResponse.json({ error: "JOB_NOT_FOUND" }, { status: 404 });
  }
  const job = loadJob(jobId);
  const [kind, sub] = segments;

  let filePath: string | undefined;
  if (kind === "tts") {
    filePath = job.tts?.file;
  } else if (kind === "cover") {
    filePath = job.cover.image?.file;
  } else if (kind === "thumb" && sub) {
    filePath = job.sources.find((s) => s.source_id === sub)?.thumbnail;
  } else if (kind === "source" && sub) {
    filePath = job.sources.find((s) => s.source_id === sub)?.file;
  } else if (kind === "final") {
    filePath = job.render?.final_file;
  }

  if (!filePath || !existsSync(filePath)) {
    return NextResponse.json({ error: "FILE_NOT_FOUND" }, { status: 404 });
  }

  const stat = await fs.stat(filePath);
  const size = stat.size;
  const ext = path.extname(filePath).toLowerCase();
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";

  // iOS Safari refuses to play <video>/<audio> at all unless the server
  // answers Range requests with 206 + Content-Range — it always probes with
  // one before it will start playback. Chrome/desktop tolerate a plain 200,
  // which is why this only ever showed up on iPhone.
  const rangeHeader = req.headers.get("range");
  if (rangeHeader) {
    const range = parseRange(rangeHeader, size);
    if (!range) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes */${size}` },
      });
    }
    const { start, end } = range;
    const nodeStream = createReadStream(filePath, { start, end });
    return new NextResponse(Readable.toWeb(nodeStream) as ReadableStream, {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      },
    });
  }

  const nodeStream = createReadStream(filePath);
  return new NextResponse(Readable.toWeb(nodeStream) as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    },
  });
}
