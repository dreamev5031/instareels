import { NextResponse } from "next/server";
import {
  ElevenLabsApiError,
  elevenLabsModelId,
  fetchElevenLabsVoice,
  synthesizeElevenLabsSpeech,
} from "@/elevenlabs/client";
import { voiceStorage } from "@/voices/storage";

export const runtime = "nodejs";

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

  // Provider lookup is intentionally deferred until preview is requested.
  // If a preview_url exists, cache it in the registry for later playback.
  try {
    const info = await fetchElevenLabsVoice(entry.voiceId);
    if (info.previewUrl) {
      await voiceStorage.cacheProviderMetadata(entry.id, {
        providerName: info.name,
        previewUrl: info.previewUrl,
        labels: info.labels,
      });
      return NextResponse.json({ previewUrl: info.previewUrl });
    }
    await voiceStorage.cacheProviderMetadata(entry.id, {
      providerName: info.name,
      labels: info.labels,
    });
  } catch {
    // A failed metadata lookup must never invalidate/delete the registered
    // voice. Fall through to a short TTS preview using the stored Voice ID.
  }

  try {
    const result = await synthesizeElevenLabsSpeech(entry.voiceId, PREVIEW_SAMPLE_TEXT, elevenLabsModelId());
    return NextResponse.json({ audioBase64: result.audio.toString("base64"), mimeType: "audio/mpeg" });
  } catch (caught) {
    if (caught instanceof ElevenLabsApiError) {
      return NextResponse.json(
        {
          error: caught.code,
          error_code: caught.code,
          message: "미리듣기를 불러오지 못했습니다.",
          debug: { provider_status: caught.status, provider_message: caught.message },
        },
        { status: caught.code === "VOICE_NOT_FOUND" ? 404 : caught.code === "ELEVENLABS_NOT_CONFIGURED" ? 503 : 502 },
      );
    }
    return NextResponse.json(
      { error: "ELEVENLABS_API_ERROR", error_code: "ELEVENLABS_API_ERROR", message: "미리듣기를 불러오지 못했습니다." },
      { status: 502 },
    );
  }
}
