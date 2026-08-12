import { Job, Voice } from "@/shared/types";

async function parseJobResponse(res: Response): Promise<Job> {
  const body = await res.json();
  if (body.job) return body.job as Job;
  throw new Error(body.message || body.error || "알 수 없는 오류가 발생했습니다.");
}

export async function fetchVoices(): Promise<Voice[]> {
  const res = await fetch("/api/voices");
  const body = await res.json();
  return body.voices as Voice[];
}

export async function generateTts(jobId: string | null, text: string, voice: string): Promise<Job> {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, text, voice }),
  });
  return parseJobResponse(res);
}

export async function uploadVideos(jobId: string, files: File[]): Promise<Job> {
  const formData = new FormData();
  formData.append("jobId", jobId);
  for (const f of files) formData.append("files", f);
  const res = await fetch("/api/upload", { method: "POST", body: formData });
  return parseJobResponse(res);
}

export async function runAnalysis(jobId: string, onProgress: (job: Job) => void): Promise<Job> {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId }),
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
