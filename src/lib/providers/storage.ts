import "server-only";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface StoredObject {
  key: string;
  url: string;
  size: number;
  mimeType: string;
}

export interface StorageProvider {
  readonly name: string;
  upload(input: {
    body: Buffer;
    mimeType: string;
    originalName: string;
    folder: string;
  }): Promise<StoredObject>;
  remove(key: string): Promise<void>;
  /** Time-limited read URL for private buckets. */
  getUrl(key: string, expiresInSeconds?: number): Promise<string>;
}

export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** Rejects anything that is not a reasonably sized image. */
export function assertUploadAllowed(file: { type: string; size: number }) {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number])) {
    throw new Error("Only JPEG, PNG, WEBP and HEIC images can be uploaded");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("Images must be 8 MB or smaller");
  }
  if (file.size <= 0) {
    throw new Error("The uploaded file is empty");
  }
}

/** Never trust a client-supplied filename — derive a safe, opaque key. */
function buildKey(folder: string, originalName: string): string {
  const ext = path.extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, "");
  const safeExt = ext.length > 1 && ext.length <= 6 ? ext : ".bin";
  const safeFolder = folder.replace(/[^a-zA-Z0-9/_-]/g, "").replace(/^\/+|\/+$/g, "");
  return `${safeFolder}/${Date.now()}-${crypto.randomUUID()}${safeExt}`;
}

class LocalStorageProvider implements StorageProvider {
  readonly name = "local";
  private readonly root = path.join(process.cwd(), "uploads");

  async upload(input: {
    body: Buffer;
    mimeType: string;
    originalName: string;
    folder: string;
  }): Promise<StoredObject> {
    const key = buildKey(input.folder, input.originalName);
    const target = path.join(this.root, key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, input.body);
    return {
      key,
      url: `/api/files/${key}`,
      size: input.body.byteLength,
      mimeType: input.mimeType,
    };
  }

  async remove(key: string): Promise<void> {
    const target = path.join(this.root, key);
    if (!target.startsWith(this.root)) throw new Error("Invalid storage key");
    await fs.rm(target, { force: true });
  }

  async getUrl(key: string): Promise<string> {
    return `/api/files/${key}`;
  }
}

/**
 * Works with AWS S3, Cloudflare R2 and Supabase Storage — anything that speaks
 * the S3 API. Configure STORAGE_ENDPOINT for R2/Supabase.
 */
class S3CompatibleStorageProvider implements StorageProvider {
  readonly name: string;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl?: string;

  constructor(name: string) {
    this.name = name;
    const bucket = process.env.STORAGE_BUCKET;
    if (!bucket) throw new Error("STORAGE_BUCKET must be set for S3-compatible storage");
    this.bucket = bucket;
    this.publicBaseUrl = process.env.STORAGE_PUBLIC_URL;
    this.client = new S3Client({
      region: process.env.STORAGE_REGION ?? "auto",
      endpoint: process.env.STORAGE_ENDPOINT || undefined,
      forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === "true",
      credentials: {
        accessKeyId: process.env.STORAGE_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY ?? "",
      },
    });
  }

  async upload(input: {
    body: Buffer;
    mimeType: string;
    originalName: string;
    folder: string;
  }): Promise<StoredObject> {
    const key = buildKey(input.folder, input.originalName);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: input.body,
        ContentType: input.mimeType,
      }),
    );
    return {
      key,
      url: this.publicBaseUrl
        ? `${this.publicBaseUrl.replace(/\/$/, "")}/${key}`
        : await this.getUrl(key),
      size: input.body.byteLength,
      mimeType: input.mimeType,
    };
  }

  async remove(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async getUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    if (this.publicBaseUrl) {
      return `${this.publicBaseUrl.replace(/\/$/, "")}/${key}`;
    }
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }
}

let cached: StorageProvider | undefined;

export function getStorageProvider(): StorageProvider {
  if (cached) return cached;
  const driver = (process.env.STORAGE_DRIVER ?? "local").toLowerCase();
  switch (driver) {
    case "s3":
    case "r2":
    case "supabase":
      cached = new S3CompatibleStorageProvider(driver);
      break;
    default:
      cached = new LocalStorageProvider();
  }
  return cached;
}
