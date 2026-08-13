import { BgmSettings, CoverSettings, Job, SubtitleSettings, Voice } from "@/shared/types";
import type { BgmTrack } from "@/bgm/storage";

// Empty string in same-origin/local dev (relative fetches keep working as-is).
// Set to the backend's public URL when the frontend is deployed separately.
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

type ApiErrorPayload = {
  stage?: string;
  error?: string;
  error_code?: string;
  message?: string;
  job?: Job;
};

export class ApiRequestError extends Error {
  readonly stage: string;
  readonly errorCode: string;
  readonly job?: Job;

  constructor(payload: Required<Pick<ApiErrorPayload, "stage" | "error_code" | "message">> & Pick<ApiErrorPayload, "job">) {
    super(`${payload.stage} / ${payload.error_code}: ${payload.message}`);
    this.name = "ApiRequestError";
    this.stage = payload.stage;
    this.errorCode = payload.error_code;
    this.job = payload.job;
  }
}

async function responsePayload(res: Response, fallbackStage: string): Promise<ApiErrorPayload> {
  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (!text.trim()) {
    throw new ApiRequestError({
      stage: fallbackStage,
      error_code: "EMPTY_RESPONSE",
      message: `서버가 빈 응답을 반환했습니다. (HTTP ${res.status})`,
    });
  }
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ApiRequestError({
      stage: fallbackStage,
      error_code: "INVALID_RESPONSE_CONTENT_TYPE",
      message: `서버 응답 형식이 올바르지 않습니다. (HTTP ${res.status})`,
    });
  }
  try {
    return JSON.parse(text) as ApiErrorPayload;
  } catch {
    throw new ApiRequestError({
      stage: fallbackStage,
      error_code: "INVALID_JSON_RESPONSE",
      message: `서버 JSON 응답을 읽지 못했습니다. (HTTP ${res.status})`,
    });
  }
}

export async function parseJobResponse(res: Response, fallbackStage = "REQUEST"): Promise<Job> {
  const body = await responsePayload(res, fallbackStage);
  if (!res.ok) {
    throw new ApiRequestError({
      stage: body.stage ?? fallbackStage,
      error_code: body.error_code ?? body.error ?? `HTTP_${res.status}`,
      message: body.message ?? "요청을 처리하지 못했습니다.",
      job: body.job,
    });
  }
  if (body.job) return body.job;
  throw new ApiRequestError({
    stage: body.stage ?? fallbackStage,
    error_code: body.error_code ?? body.error ?? "JOB_RESPONSE_MISSING",
    message: body.message ?? "JOB 결과를 받지 못했습니다.",
  });
}

export async function fetchVoices(): Promise<Voice[]> {
  const res = await fetch(`${API_BASE_URL}/api/voices`);
  const body = await res.json();
  return body.voices as Voice[];
}

export async function fetchBgmTracks(): Promise<BgmTrack[]> {
  const res = await fetch(`${API_BASE_URL}/api/bgm`);
  if (!res.ok) throw new Error("BGM 목록을 불러오지 못했습니다.");
  const body = await res.json() as unknown;
  if (!Array.isArray(body)) throw new Error("BGM 목록 응답이 올바르지 않습니다.");
  return body as BgmTrack[];
}

export async function uploadBgm(file: File): Promise<{ track: BgmTrack; tracks: BgmTrack[] }> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE_URL}/api/bgm/upload`, { method: "POST", body: formData });
  const body = await res.json().catch(() => ({})) as {
    track?: BgmTrack;
    tracks?: BgmTrack[];
    error_code?: string;
    message?: string;
  };
  if (!res.ok || !body.track || !Array.isArray(body.tracks)) {
    throw new Error(`${body.error_code ?? `HTTP_${res.status}`}: ${body.message ?? "BGM 업로드 실패"}`);
  }
  return { track: body.track, tracks: body.tracks };
}

export async function generateTts(jobId: string | null, text: string, voice: string): Promise<Job> {
  const res = await fetch(`${API_BASE_URL}/api/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, text, voice }),
  });
  return parseJobResponse(res);
}

export async function uploadVideos(jobId: string, files: File[], ocrEnabled: boolean): Promise<Job> {
  const formData = new FormData();
  formData.append("jobId", jobId);
  formData.append("ocrEnabled", String(ocrEnabled));
  for (const f of files) formData.append("files", f);
  const res = await fetch(`${API_BASE_URL}/api/upload?jobId=${encodeURIComponent(jobId)}`, { method: "POST", body: formData });
  return parseJobResponse(res, "UPLOAD");
}

export async function saveCover(
  jobId: string,
  file: File | null,
  settings: Omit<CoverSettings, "image">
): Promise<Job> {
  const formData = new FormData();
  formData.append("jobId", jobId);
  formData.append("settings", JSON.stringify(settings));
  if (file) formData.append("file", file);
  const res = await fetch(`${API_BASE_URL}/api/cover`, { method: "POST", body: formData });
  return parseJobResponse(res);
}

export async function runAnalysis(
  jobId: string,
  ocrEnabled: boolean,
  onProgress: (job: Job) => void
): Promise<Job> {
  const res = await fetch(`${API_BASE_URL}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, ocrEnabled }),
  });

  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || body.error || "분석 요청에 실패했습니다.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastJob: Job | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line);
      if (parsed.job) {
        lastJob = parsed.job as Job;
        onProgress(lastJob);
      }
    }
  }

  if (!lastJob) throw new Error("분석 결과를 받지 못했습니다.");
  return lastJob;
}

export async function renderVideo(
  jobId: string,
  onProgress: (job: Job) => void,
): Promise<Job> {
  const res = await fetch(`${API_BASE_URL}/api/job/${jobId}/render`, { method: "POST" });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || body.error_code || "영상 렌더 요청에 실패했습니다.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastJob: Job | null = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line);
      if (parsed.job) {
        lastJob = parsed.job as Job;
        onProgress(lastJob);
      }
    }
  }
  if (!lastJob) throw new Error("렌더 결과를 받지 못했습니다.");
  return lastJob;
}

export async function saveSubtitle(jobId: string, settings: SubtitleSettings): Promise<Job> {
  const res = await fetch(`${API_BASE_URL}/api/job/${jobId}/subtitle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message || body.error || "자막 설정 저장에 실패했습니다.");
  if (!body.job) throw new Error("자막 설정 결과를 받지 못했습니다.");
  return body.job as Job;
}

export async function saveBgm(jobId: string, settings: BgmSettings): Promise<Job> {
  const res = await fetch(`${API_BASE_URL}/api/job/${jobId}/bgm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings }),
  });
  return parseJobResponse(res, "BGM");
}
