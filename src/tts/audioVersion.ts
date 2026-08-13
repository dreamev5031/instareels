import type { TtsResult } from "@/shared/types";

/**
 * The generated TTS audio file is overwritten in place under the same
 * job_id/filename on every regeneration (Edge and ElevenLabs both write to
 * the same `tts.mp3` path), so `/api/media/{jobId}/tts` alone never changes
 * across a provider/voice switch. Without a fingerprint appended, React
 * leaves an <audio> element's `src` attribute untouched (identical string)
 * and browsers keep playing whatever was already buffered from the
 * previous provider/voice — this is the root cause of "hearing the old
 * Edge voice" after switching to ElevenLabs. Use this both as a query
 * param (forces a real refetch) and as a React `key` (forces a full
 * element remount, clearing any in-flight buffer/playback state).
 */
export function ttsAudioVersion(tts: TtsResult | undefined): string {
  if (!tts) return "";
  return `${tts.provider}:${tts.voice}:${tts.duration}`;
}

export function ttsAudioSrc(baseUrl: string, jobId: string, tts: TtsResult | undefined): string {
  return `${baseUrl}/api/media/${jobId}/tts?v=${encodeURIComponent(ttsAudioVersion(tts))}`;
}
