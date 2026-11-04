import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalImageStorage, getImageStorage, tigrisPublicUrl } from './storage';

describe('LocalImageStorage', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'wiki-images-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('writes the buffer under the given key and returns a URL containing it', async () => {
    const storage = new LocalImageStorage(dir);
    const url = await storage.put('pages/abc/photo.webp', Buffer.from('fake-bytes'), 'image/webp');
    expect(url).toContain('pages/abc/photo.webp');
    const written = await readFile(path.join(dir, 'pages/abc/photo.webp'));
    expect(written.toString()).toBe('fake-bytes');
  });

  it('delete removes the file', async () => {
    const storage = new LocalImageStorage(dir);
    await storage.put('x.webp', Buffer.from('a'), 'image/webp');
    await storage.delete('x.webp');
    await expect(readFile(path.join(dir, 'x.webp'))).rejects.toThrow();
  });

  it('delete of a missing file does not throw', async () => {
    await expect(new LocalImageStorage(dir).delete('nope.webp')).resolves.toBeUndefined();
  });

  it('rejects keys that escape the base directory', async () => {
    const storage = new LocalImageStorage(dir);
    await expect(storage.put('../evil.webp', Buffer.from('a'), 'image/webp')).rejects.toThrow();
  });
});

describe('getImageStorage', () => {
  it('returns LocalImageStorage when no AWS credentials are configured', () => {
    delete process.env.AWS_ACCESS_KEY_ID;
    expect(getImageStorage()).toBeInstanceOf(LocalImageStorage);
  });
});

describe('tigrisPublicUrl', () => {
  it('uses the bucket-subdomain form Tigris serves public objects from', () => {
    expect(tigrisPublicUrl('https://fly.storage.tigris.dev', 'my-bucket', 'wiki/a.webp')).toBe('https://my-bucket.fly.storage.tigris.dev/wiki/a.webp');
  });
});
