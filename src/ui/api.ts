import { CoverSettings, Job, SubtitleSettings, Voice } from "@/shared/types";

// Empty string in same-origin/local dev (relative fetches keep working as-is).
// Set to the backend's public URL when the frontend is deployed separately.
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

async function parseJobResponse(res: Response): Promise<Job> {
  const body = await res.json();
  if (body.job) return body.job as Job;
  throw new Error(body.message || body.error || "알 수 없는 오류가 발생했습니다.");
}

export async function fetchVoices(): Promise<Voice[]> {
  const res = await fetch(`${API_BASE_URL}/api/voices`);
  const body = await res.json();
  return body.voices as Voice[];
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
  const res = await fetch(`${API_BASE_URL}/api/upload`, { method: "POST", body: formData });
  return parseJobResponse(res);
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
