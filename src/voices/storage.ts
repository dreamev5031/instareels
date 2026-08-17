import { randomUUID } from "node:crypto";
import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const VOICE_REGISTRY_KEY = "voices/elevenlabs.json";

export interface ElevenLabsVoiceEntry {
  id: string;
  provider: "elevenlabs";
  voiceId: string;
  alias: string;
  providerName?: string;
  previewUrl?: string;
  labels?: Record<string, string>;
  createdAt: string;
}

interface StorageConfig {
  bucket: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

// Reuses the same Railway Bucket the BGM library persists to (BGM_* env
// vars), just under a different key prefix. No separate bucket/env vars
// needed for Voice registry storage.
function loadConfig(): StorageConfig | undefined {
  const bucket = process.env.BGM_BUCKET?.trim();
  const endpoint = process.env.BGM_ENDPOINT?.trim();
  const region = process.env.BGM_REGION?.trim();
  const accessKeyId = process.env.BGM_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.BGM_SECRET_ACCESS_KEY?.trim();
  if (!bucket || !endpoint || !region || !accessKeyId || !secretAccessKey) return undefined;
  return { bucket, endpoint, region, accessKeyId, secretAccessKey };
}

function createClient(config: StorageConfig): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
}

export class VoiceStorage {
  private readonly config: StorageConfig | undefined;
  private readonly client: S3Client | undefined;

  constructor(config = loadConfig(), client?: S3Client) {
    this.config = config;
    this.client = config ? client ?? createClient(config) : undefined;
  }

  isConfigured(): boolean {
    return Boolean(this.config && this.client);
  }

  async listVoices(): Promise<ElevenLabsVoiceEntry[]> {
    if (!this.config || !this.client) return [];
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: VOICE_REGISTRY_KEY }));
      const text = await response.Body!.transformToString("utf-8");
      const parsed = JSON.parse(text) as unknown;
      return Array.isArray(parsed) ? (parsed as ElevenLabsVoiceEntry[]) : [];
    } catch (caught) {
      if (caught instanceof NoSuchKey) return [];
      throw caught;
    }
  }

  private async saveVoices(voices: ElevenLabsVoiceEntry[]): Promise<void> {
    if (!this.config || !this.client) throw new Error("VOICE_REGISTRY_NOT_CONFIGURED");
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: VOICE_REGISTRY_KEY,
      Body: JSON.stringify(voices, null, 2),
      ContentType: "application/json",
    }));
  }

  async findById(id: string): Promise<ElevenLabsVoiceEntry | undefined> {
    return (await this.listVoices()).find((entry) => entry.id === id);
  }

  async findByVoiceId(voiceId: string): Promise<ElevenLabsVoiceEntry | undefined> {
    return (await this.listVoices()).find((entry) => entry.voiceId === voiceId);
  }

  async addVoice(input: {
    voiceId: string;
    alias: string;
    providerName?: string;
    previewUrl?: string;
    labels?: Record<string, string>;
  }): Promise<ElevenLabsVoiceEntry> {
    const voices = await this.listVoices();
    const existingIndex = voices.findIndex((entry) => entry.voiceId === input.voiceId);

    if (existingIndex >= 0) {
      const existing = voices[existingIndex]!;
      const updated: ElevenLabsVoiceEntry = {
        ...existing,
        alias: input.alias,
        ...(input.providerName ? { providerName: input.providerName } : {}),
        ...(input.previewUrl ? { previewUrl: input.previewUrl } : {}),
        ...(input.labels ? { labels: input.labels } : {}),
      };
      const next = [...voices];
      next[existingIndex] = updated;
      await this.saveVoices(next);
      return updated;
    }

    const entry: ElevenLabsVoiceEntry = {
      id: randomUUID(),
      provider: "elevenlabs",
      voiceId: input.voiceId,
      alias: input.alias,
      ...(input.providerName ? { providerName: input.providerName } : {}),
      ...(input.previewUrl ? { previewUrl: input.previewUrl } : {}),
      ...(input.labels ? { labels: input.labels } : {}),
      createdAt: new Date().toISOString(),
    };
    await this.saveVoices([...voices, entry]);
    return entry;
  }

  async cacheProviderMetadata(
    id: string,
    input: { providerName?: string; previewUrl?: string; labels?: Record<string, string> },
  ): Promise<ElevenLabsVoiceEntry | undefined> {
    const voices = await this.listVoices();
    const index = voices.findIndex((entry) => entry.id === id);
    if (index < 0) return undefined;

    const existing = voices[index]!;
    const updated: ElevenLabsVoiceEntry = {
      ...existing,
      ...(input.providerName ? { providerName: input.providerName } : {}),
      ...(input.previewUrl ? { previewUrl: input.previewUrl } : {}),
      ...(input.labels ? { labels: input.labels } : {}),
    };
    const next = [...voices];
    next[index] = updated;
    await this.saveVoices(next);
    return updated;
  }

  async removeVoice(id: string): Promise<boolean> {
    const voices = await this.listVoices();
    const next = voices.filter((entry) => entry.id !== id);
    if (next.length === voices.length) return false;
    await this.saveVoices(next);
    return true;
  }
}

export const voiceStorage = new VoiceStorage();
