const ELEVENLABS_API_BASE = "https://api.elevenlabs.io";

/** eleven_multilingual_v2: battle-tested quality across languages incl.
 *  Korean, and supported by the /with-timestamps endpoint. */
export const DEFAULT_ELEVENLABS_MODEL_ID = "eleven_multilingual_v2";

export function elevenLabsModelId(): string {
  return process.env.ELEVENLABS_MODEL_ID?.trim() || DEFAULT_ELEVENLABS_MODEL_ID;
}

export type ElevenLabsErrorCode =
  | "ELEVENLABS_NOT_CONFIGURED"
  | "VOICE_NOT_FOUND"
  | "INVALID_VOICE_ID"
  | "ELEVENLABS_QUOTA_EXCEEDED"
  | "ELEVENLABS_API_ERROR";

export class ElevenLabsApiError extends Error {
  constructor(
    readonly code: ElevenLabsErrorCode,
    message: string,
    readonly status?: number,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "ElevenLabsApiError";
  }
}

function apiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  if (!key) throw new ElevenLabsApiError("ELEVENLABS_NOT_CONFIGURED", "ElevenLabs API Key가 서버에 설정되지 않았습니다.");
  return key;
}

async function parseErrorBody(res: Response): Promise<{ status?: string; message?: string; raw: string }> {
  const raw = await res.text().catch(() => "");
  try {
    const parsed = JSON.parse(raw) as { detail?: string | { status?: string; message?: string } };
    if (typeof parsed.detail === "string") return { message: parsed.detail, raw };
    if (parsed.detail && typeof parsed.detail === "object") {
      return { status: parsed.detail.status, message: parsed.detail.message, raw };
    }
  } catch {
    // Non-JSON error body; fall through with just the raw text.
  }
  return { raw };
}

function classifyError(res: Response, body: { status?: string }): ElevenLabsErrorCode {
  if (res.status === 404) return "VOICE_NOT_FOUND";
  if (res.status === 401 && body.status === "quota_exceeded") return "ELEVENLABS_QUOTA_EXCEEDED";
  if (res.status === 400 || res.status === 422) return "INVALID_VOICE_ID";
  return "ELEVENLABS_API_ERROR";
}

async function elevenLabsFetch(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (caught) {
    throw new ElevenLabsApiError(
      "ELEVENLABS_API_ERROR",
      `ElevenLabs 연결에 실패했습니다: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
  }
}

export interface ElevenLabsVoiceInfo {
  voiceId: string;
  name: string;
  previewUrl?: string;
  labels?: Record<string, string>;
  category?: string;
}

export async function fetchElevenLabsVoice(voiceId: string): Promise<ElevenLabsVoiceInfo> {
  const key = apiKey();
  const res = await elevenLabsFetch(`${ELEVENLABS_API_BASE}/v1/voices/${encodeURIComponent(voiceId)}`, {
    headers: { "xi-api-key": key },
  });
  if (!res.ok) {
    const body = await parseErrorBody(res);
    const code = classifyError(res, body);
    throw new ElevenLabsApiError(
      code,
      code === "VOICE_NOT_FOUND"
        ? "ElevenLabs에서 해당 Voice ID를 찾을 수 없습니다."
        : body.message || `ElevenLabs voice 조회에 실패했습니다. (HTTP ${res.status})`,
      res.status,
      body.raw.slice(0, 2000),
    );
  }
  const data = (await res.json()) as {
    voice_id?: string;
    name?: string;
    preview_url?: string;
    labels?: Record<string, string>;
    category?: string;
  };
  return {
    voiceId: String(data.voice_id ?? voiceId),
    name: String(data.name ?? ""),
    previewUrl: data.preview_url || undefined,
    labels: data.labels && typeof data.labels === "object" ? data.labels : undefined,
    category: data.category || undefined,
  };
}

export interface ElevenLabsAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export interface ElevenLabsSynthesisResult {
  audio: Buffer;
  alignment?: ElevenLabsAlignment;
}

/** Calls the official `/with-timestamps` endpoint so audio and real
 *  character-level alignment come back together in one response. Do not
 *  swap this for the plain `/v1/text-to-speech/{voice_id}` endpoint —
 *  that one has no timing data at all. */
export async function synthesizeElevenLabsSpeech(
  voiceId: string,
  text: string,
  modelId: string,
): Promise<ElevenLabsSynthesisResult> {
  const key = apiKey();
  const res = await elevenLabsFetch(`${ELEVENLABS_API_BASE}/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: modelId }),
  });
  if (!res.ok) {
    const body = await parseErrorBody(res);
    const code = classifyError(res, body);
    throw new ElevenLabsApiError(code, body.message || `ElevenLabs TTS 생성에 실패했습니다. (HTTP ${res.status})`, res.status, body.raw.slice(0, 2000));
  }
  const data = (await res.json()) as { audio_base64?: string; alignment?: ElevenLabsAlignment };
  if (!data.audio_base64) {
    throw new ElevenLabsApiError("ELEVENLABS_API_ERROR", "ElevenLabs 응답에 오디오 데이터가 없습니다.");
  }
  return { audio: Buffer.from(data.audio_base64, "base64"), alignment: data.alignment };
}
