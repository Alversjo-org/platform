import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export interface ImageStorage {
  put(key: string, buffer: Buffer, contentType: string): Promise<string>;
  delete(key: string): Promise<void>;
}

export const DEFAULT_LOCAL_IMAGE_DIR = path.join(process.cwd(), '.data', 'images');

/** Resolve `key` inside `base`, refusing anything that escapes it. */
export function resolveImagePath(base: string, key: string): string {
  const root = path.resolve(base);
  const full = path.resolve(root, key);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error(`Invalid image key: ${key}`);
  }
  return full;
}

export class LocalImageStorage implements ImageStorage {
  constructor(private readonly baseDir: string = DEFAULT_LOCAL_IMAGE_DIR) {}

  async put(key: string, buffer: Buffer, _contentType: string): Promise<string> {
    const file = resolveImagePath(this.baseDir, key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, buffer);
    return `/images/${key}`;
  }

  async delete(key: string): Promise<void> {
    await rm(resolveImagePath(this.baseDir, key), { force: true });
  }
}

export class TigrisImageStorage implements ImageStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor({ bucket }: { bucket: string }) {
    this.bucket = bucket;
    this.client = new S3Client({
      endpoint: process.env.AWS_ENDPOINT_URL_S3,
      region: process.env.AWS_REGION ?? 'auto',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
      },
    });
  }

  async put(key: string, buffer: Buffer, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buffer, ContentType: contentType }),
    );
    // Unverified against a live bucket (plan: implementer's call) — confirm Tigris's public URL format before production use.
    return `${process.env.AWS_ENDPOINT_URL_S3}/${this.bucket}/${key}`;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export function getImageStorage(): ImageStorage {
  if (process.env.AWS_ACCESS_KEY_ID) {
    return new TigrisImageStorage({ bucket: process.env.BUCKET_NAME ?? 'alversjo-platform-images' });
  }
  return new LocalImageStorage();
}
