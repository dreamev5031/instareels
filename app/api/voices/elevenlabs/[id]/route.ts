import { NextResponse } from "next/server";
import { voiceStorage } from "@/voices/storage";

export const runtime = "nodejs";

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!voiceStorage.isConfigured()) {
    return NextResponse.json(
      { error: "VOICE_REGISTRY_UNAVAILABLE", error_code: "VOICE_REGISTRY_UNAVAILABLE", message: "목소리 저장소가 연결되지 않았습니다." },
      { status: 503 },
    );
  }
  const removed = await voiceStorage.removeVoice(id);
  if (!removed) {
    return NextResponse.json({ error: "VOICE_NOT_FOUND", error_code: "VOICE_NOT_FOUND", message: "삭제할 목소리를 찾지 못했습니다." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
