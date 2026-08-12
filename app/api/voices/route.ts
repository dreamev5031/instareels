import { NextResponse } from "next/server";
import { SUPPORTED_VOICES } from "@/tts/voices";

export async function GET() {
  return NextResponse.json({ voices: SUPPORTED_VOICES });
}
