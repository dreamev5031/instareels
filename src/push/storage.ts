import { randomUUID } from "node:crypto";
import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const PUSH_SUBSCRIPTIONS_KEY = "push/subscriptions.json";

export interface PushSubscriptionEntry {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  deviceId: string;
  createdAt: string;
}

interface StorageConfig {
  bucket: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

// Reuses the same Railway Bucket as BGM/Voice registry — same env vars,
// different key prefix. No new storage infra for push subscriptions.
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

export class PushSubscriptionStorage {
  private readonly config: StorageConfig | undefined;
  private readonly client: S3Client | undefined;

  constructor(config = loadConfig(), client?: S3Client) {
    this.config = config;
    this.client = config ? client ?? createClient(config) : undefined;
  }

  isConfigured(): boolean {
    return Boolean(this.config && this.client);
  }

  async listSubscriptions(): Promise<PushSubscriptionEntry[]> {
    if (!this.config || !this.client) return [];
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: PUSH_SUBSCRIPTIONS_KEY }));
      const text = await response.Body!.transformToString("utf-8");
      const parsed = JSON.parse(text) as unknown;
      return Array.isArray(parsed) ? (parsed as PushSubscriptionEntry[]) : [];
    } catch (caught) {
      if (caught instanceof NoSuchKey) return [];
      throw caught;
    }
  }

  private async saveSubscriptions(subscriptions: PushSubscriptionEntry[]): Promise<void> {
    if (!this.config || !this.client) throw new Error("PUSH_STORAGE_NOT_CONFIGURED");
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: PUSH_SUBSCRIPTIONS_KEY,
      Body: JSON.stringify(subscriptions, null, 2),
      ContentType: "application/json",
    }));
  }

  /** Upserts by (endpoint) — re-subscribing the same browser/device
   *  replaces its old keys instead of accumulating duplicates. */
  async addSubscription(input: { endpoint: string; p256dh: string; auth: string; deviceId: string }): Promise<PushSubscriptionEntry> {
    const subscriptions = await this.listSubscriptions();
    const existing = subscriptions.find((entry) => entry.endpoint === input.endpoint);
    const entry: PushSubscriptionEntry = {
      id: existing?.id ?? randomUUID(),
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      deviceId: input.deviceId,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    const next = [...subscriptions.filter((item) => item.endpoint !== input.endpoint), entry];
    await this.saveSubscriptions(next);
    return entry;
  }

  async removeSubscription(endpoint: string): Promise<boolean> {
    const subscriptions = await this.listSubscriptions();
    const next = subscriptions.filter((entry) => entry.endpoint !== endpoint);
    if (next.length === subscriptions.length) return false;
    await this.saveSubscriptions(next);
    return true;
  }

  /** Drops a subscription the push service reports as gone (404/410) —
   *  called from the send path, not user-triggered, so it should never
   *  throw even if storage happens to be unavailable at that moment. */
  async removeSubscriptionSilently(endpoint: string): Promise<void> {
    try {
      await this.removeSubscription(endpoint);
    } catch {
      // Best-effort cleanup only.
    }
  }
}

export const pushSubscriptionStorage = new PushSubscriptionStorage();
