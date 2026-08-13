import { NextResponse } from "next/server";
import { bgmStorage } from "@/bgm/storage";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await bgmStorage.listTracks());
  } catch {
    return NextResponse.json({ error: "BGM_LIST_UNAVAILABLE" }, { status: 503 });
  }
}
