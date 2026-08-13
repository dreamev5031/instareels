import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
  type _Object as S3Object,
} from "@aws-sdk/client-s3";

const BGM_PREFIX = "bgm/";
const BGM_ID_PATTERN = /^[a-f0-9]{64}$/;
export const BGM_AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".aac"] as const;

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
};

export interface BgmTrack {
  id: string;
  name: string;
  durationSeconds?: number;
}

export interface BgmStream {
  body: NonNullable<GetObjectCommandOutput["Body"]>;
  contentLength: number;
  contentType: string;
  contentRange?: string;
}

export interface ByteRange {
  start: number;
  end: number;
}

export class InvalidBgmRangeError extends RangeError {
  constructor(readonly size: number) {
    super("INVALID_BGM_RANGE");
    this.name = "InvalidBgmRangeError";
  }
}

interface StorageConfig {
  bucket: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

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
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export function bgmIdForKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function isValidBgmId(id: string): boolean {
  return BGM_ID_PATTERN.test(id);
}

export function friendlyBgmName(key: string): string {
  const fileName = key.split("/").at(-1) ?? key;
  return fileName
    .replace(/\.(mp3|wav|m4a|aac)$/iu, "")
    .replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function parseByteRange(header: string, size: number): ByteRange | undefined {
  if (!Number.isSafeInteger(size) || size <= 0) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return undefined;

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return undefined;
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= size
  ) {
    return undefined;
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}

function durationFromMetadata(metadata: Record<string, string> | undefined): number | undefined {
  const raw = metadata?.["duration-seconds"] ?? metadata?.durationseconds ?? metadata?.duration;
  if (!raw) return undefined;
  const duration = Number(raw);
  return Number.isFinite(duration) && duration > 0 ? duration : undefined;
}

function isBgmAudioKey(key: string | undefined): key is string {
  return Boolean(
    key &&
    key.startsWith(BGM_PREFIX) &&
    key.length > BGM_PREFIX.length &&
    BGM_AUDIO_EXTENSIONS.includes(path.extname(key).toLowerCase() as (typeof BGM_AUDIO_EXTENSIONS)[number]),
  );
}

function displayNameFromMetadata(metadata: Record<string, string> | undefined, key: string): string {
  const encoded = metadata?.["display-name"];
  if (!encoded) return friendlyBgmName(key);
  try {
    return decodeURIComponent(encoded);
  } catch {
    return friendlyBgmName(key);
  }
}

export class BgmStorage {
  private readonly config: StorageConfig | undefined;
  private readonly client: S3Client | undefined;

  constructor(config = loadConfig(), client?: S3Client) {
    this.config = config;
    this.client = config ? client ?? createClient(config) : undefined;
  }

  isConfigured(): boolean {
    return Boolean(this.config && this.client);
  }

  private async listObjects(): Promise<S3Object[]> {
    if (!this.config || !this.client) return [];
    const objects: S3Object[] = [];
    let continuationToken: string | undefined;
    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: BGM_PREFIX,
          ContinuationToken: continuationToken,
        })
      );
      objects.push(...(response.Contents ?? []).filter((object) => isBgmAudioKey(object.Key)));
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
    return objects;
  }

  async listTracks(): Promise<BgmTrack[]> {
    if (!this.config || !this.client) return [];
    const objects = await this.listObjects();
    return Promise.all(
      objects.map(async (object) => {
        const key = object.Key!;
        let durationSeconds: number | undefined;
        let name = friendlyBgmName(key);
        try {
          const head = await this.client!.send(
            new HeadObjectCommand({ Bucket: this.config!.bucket, Key: key })
          );
          durationSeconds = durationFromMetadata(head.Metadata);
          name = displayNameFromMetadata(head.Metadata, key);
        } catch {
          // Duration is optional. A metadata lookup failure must not hide a playable track.
        }
        return {
          id: bgmIdForKey(key),
          name,
          ...(durationSeconds ? { durationSeconds } : {}),
        };
      })
    );
  }

  private async resolveKey(id: string): Promise<string | undefined> {
    if (!isValidBgmId(id)) return undefined;
    const objects = await this.listObjects();
    return objects.map((object) => object.Key!).find((key) => bgmIdForKey(key) === id);
  }

  async streamTrack(id: string, rangeHeader?: string): Promise<BgmStream | undefined> {
    if (!this.config || !this.client || !isValidBgmId(id)) return undefined;
    const key = await this.resolveKey(id);
    if (!key || !isBgmAudioKey(key)) return undefined;

    const head = await this.client.send(
      new HeadObjectCommand({ Bucket: this.config.bucket, Key: key })
    );
    const size = head.ContentLength;
    if (typeof size !== "number" || size < 0) throw new Error("BGM_OBJECT_SIZE_UNAVAILABLE");

    const range = rangeHeader ? parseByteRange(rangeHeader, size) : undefined;
    if (rangeHeader && !range) throw new InvalidBgmRangeError(size);
    const rangeValue = range ? `bytes=${range.start}-${range.end}` : undefined;
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ...(rangeValue ? { Range: rangeValue } : {}),
      })
    );
    if (!response.Body) throw new Error("BGM_OBJECT_BODY_UNAVAILABLE");

    return {
      body: response.Body,
      contentLength: range ? range.end - range.start + 1 : size,
      contentType: response.ContentType ?? head.ContentType ?? CONTENT_TYPE_BY_EXTENSION[path.extname(key).toLowerCase()] ?? "application/octet-stream",
      ...(range ? { contentRange: `bytes ${range.start}-${range.end}/${size}` } : {}),
    };
  }

  async downloadTrack(id: string, destination: string): Promise<boolean> {
    const track = await this.streamTrack(id);
    if (!track) return false;
    await fs.writeFile(destination, Buffer.from(await track.body.transformToByteArray()));
    return true;
  }

  async uploadTrack(input: {
    originalFilename: string;
    buffer: Buffer;
    durationSeconds: number;
    codecName: string;
  }): Promise<BgmTrack> {
    if (!this.config || !this.client) throw new Error("BGM_BUCKET_NOT_CONFIGURED");
    const extension = path.extname(input.originalFilename).toLowerCase();
    if (!BGM_AUDIO_EXTENSIONS.includes(extension as (typeof BGM_AUDIO_EXTENSIONS)[number])) {
      throw new Error("BGM_UNSUPPORTED_FORMAT");
    }
    const name = friendlyBgmName(input.originalFilename) || "BGM";
    const key = `${BGM_PREFIX}${randomUUID()}${extension}`;
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: input.buffer,
      ContentType: CONTENT_TYPE_BY_EXTENSION[extension],
      Metadata: {
        "display-name": encodeURIComponent(name),
        "duration-seconds": String(input.durationSeconds),
        codec: input.codecName,
      },
    }));
    return {
      id: bgmIdForKey(key),
      name,
      durationSeconds: input.durationSeconds,
    };
  }
}

export const bgmStorage = new BgmStorage();
