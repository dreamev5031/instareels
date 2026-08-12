import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { jobExists, loadJob } from "@/jobs/store";

const CONTENT_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".m4v": "video/mp4",
};

export async function GET(
  _req: Request,
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
  } else if (kind === "thumb" && sub) {
    filePath = job.sources.find((s) => s.source_id === sub)?.thumbnail;
  } else if (kind === "source" && sub) {
    filePath = job.sources.find((s) => s.source_id === sub)?.file;
  }

  if (!filePath || !existsSync(filePath)) {
    return NextResponse.json({ error: "FILE_NOT_FOUND" }, { status: 404 });
  }

  const buffer = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    },
  });
}
