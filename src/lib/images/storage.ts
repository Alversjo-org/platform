import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/**
 * Images are private: `put` returns an app URL (`/images/<key>`), and the /images route
 * (members only) reads them back through `get`. No bucket URL is ever handed to a browser.
 */
export interface ImageStorage {
  put(key: string, buffer: Buffer, contentType: string): Promise<string>;
  get(key: string): Promise<{ buffer: Buffer; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

const SERVABLE_PREFIXES = ['wiki', 'tasks'];

/** Whether the /images route may serve this key: a known prefix, plain single-segment names, no traversal. */
export function isServableImageKey(segments: string[]): boolean {
  if (segments.length < 2 || !SERVABLE_PREFIXES.includes(segments[0])) return false;
  return segments.every((seg) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(seg) && seg !== '..');
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

  async get(key: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    const file = resolveImagePath(this.baseDir, key);
    try {
      return { buffer: await readFile(file), contentType: 'image/webp' };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
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
    return `/images/${key}`;
  }

  async get(key: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!res.Body) return null;
      return { buffer: Buffer.from(await res.Body.transformToByteArray()), contentType: res.ContentType ?? 'image/webp' };
    } catch (e) {
      if (e instanceof NoSuchKey) return null;
      throw e;
    }
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
