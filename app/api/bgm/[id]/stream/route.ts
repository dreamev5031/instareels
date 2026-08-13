import { NextResponse } from "next/server";
import {
  bgmStorage,
  InvalidBgmRangeError,
  isValidBgmId,
} from "@/bgm/storage";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isValidBgmId(id)) {
    return NextResponse.json({ error: "INVALID_BGM_ID" }, { status: 400 });
  }

  try {
    const track = await bgmStorage.streamTrack(id, request.headers.get("range") ?? undefined);
    if (!track) {
      return NextResponse.json({ error: "BGM_NOT_FOUND" }, { status: 404 });
    }

    return new Response(track.body.transformToWebStream(), {
      status: track.contentRange ? 206 : 200,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": String(track.contentLength),
        "Content-Type": "audio/mpeg",
        "Cache-Control": "private, max-age=3600",
        ...(track.contentRange ? { "Content-Range": track.contentRange } : {}),
      },
    });
  } catch (error) {
    if (error instanceof InvalidBgmRangeError) {
      return new Response(null, {
        status: 416,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes */${error.size}`,
        },
      });
    }
    return NextResponse.json({ error: "BGM_STREAM_UNAVAILABLE" }, { status: 503 });
  }
}
