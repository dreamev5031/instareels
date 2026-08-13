import { NextResponse } from "next/server";
import { ElevenLabsApiError, elevenLabsModelId, synthesizeElevenLabsSpeech } from "@/elevenlabs/client";
import { voiceStorage } from "@/voices/storage";

export const runtime = "nodejs";

// Only used as a fallback when the registered voice has no preview_url —
// voices with a preview_url are played directly from that URL client-side
// with no TTS credits spent.
const PREVIEW_SAMPLE_TEXT = "안녕하세요. 목소리 미리듣기입니다.";

export async function POST(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const entry = await voiceStorage.findById(id);
  if (!entry) {
    return NextResponse.json({ error: "VOICE_NOT_FOUND", error_code: "VOICE_NOT_FOUND", message: "목소리를 찾지 못했습니다." }, { status: 404 });
  }
  if (entry.previewUrl) {
    return NextResponse.json({ previewUrl: entry.previewUrl });
  }

  try {
    const result = await synthesizeElevenLabsSpeech(entry.voiceId, PREVIEW_SAMPLE_TEXT, elevenLabsModelId());
    return NextResponse.json({ audioBase64: result.audio.toString("base64"), mimeType: "audio/mpeg" });
  } catch (caught) {
    if (caught instanceof ElevenLabsApiError) {
      return NextResponse.json(
        { error: caught.code, error_code: caught.code, message: caught.message },
        { status: caught.code === "VOICE_NOT_FOUND" ? 404 : caught.code === "ELEVENLABS_NOT_CONFIGURED" ? 503 : 502 },
      );
    }
    return NextResponse.json(
      { error: "ELEVENLABS_API_ERROR", error_code: "ELEVENLABS_API_ERROR", message: caught instanceof Error ? caught.message : String(caught) },
      { status: 502 },
    );
  }
}
