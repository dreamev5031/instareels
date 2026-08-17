import { NextResponse } from "next/server";
import { voiceStorage } from "@/voices/storage";

export const runtime = "nodejs";

export async function GET() {
  try {
    const voices = await voiceStorage.listVoices();
    return NextResponse.json({ voices });
  } catch (caught) {
    return NextResponse.json(
      { error: "VOICE_REGISTRY_UNAVAILABLE", error_code: "VOICE_REGISTRY_UNAVAILABLE", message: caught instanceof Error ? caught.message : "목소리 저장소를 불러오지 못했습니다." },
      { status: 503 },
    );
  }
}

export async function POST(req: Request) {
  let body: { voiceId?: string; alias?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY", message: "요청 본문이 올바르지 않습니다." }, { status: 400 });
  }

  const voiceId = body.voiceId?.trim();
  const alias = body.alias?.trim();
  if (!voiceId) {
    return NextResponse.json({ error: "VOICE_ID_REQUIRED", error_code: "VOICE_ID_REQUIRED", message: "Voice ID를 입력해 주세요." }, { status: 400 });
  }
  if (!alias) {
    return NextResponse.json({ error: "VOICE_ALIAS_REQUIRED", error_code: "VOICE_ALIAS_REQUIRED", message: "별명을 입력해 주세요." }, { status: 400 });
  }
  if (!voiceStorage.isConfigured()) {
    return NextResponse.json(
      { error: "VOICE_REGISTRY_UNAVAILABLE", error_code: "VOICE_REGISTRY_UNAVAILABLE", message: "목소리 저장소가 연결되지 않았습니다." },
      { status: 503 },
    );
  }

  try {
    // Registration intentionally performs no ElevenLabs API request.
    // The user-supplied Voice ID is trusted and persisted verbatim apart
    // from surrounding whitespace. Provider validity is checked only when
    // preview/TTS is actually requested.
    const entry = await voiceStorage.addVoice({ voiceId, alias });
    return NextResponse.json({ voice: entry });
  } catch (caught) {
    return NextResponse.json(
      { error: "VOICE_REGISTRY_UNAVAILABLE", error_code: "VOICE_REGISTRY_UNAVAILABLE", message: caught instanceof Error ? caught.message : "목소리를 저장하지 못했습니다." },
      { status: 503 },
    );
  }
}
