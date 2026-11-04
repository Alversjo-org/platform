import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalImageStorage, getImageStorage, isServableImageKey } from './storage';

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

describe('LocalImageStorage.get', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'wiki-images-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('returns what was put, with its content type', async () => {
    const storage = new LocalImageStorage(dir);
    await storage.put('wiki/a.webp', Buffer.from('bytes'), 'image/webp');
    const got = await storage.get('wiki/a.webp');
    expect(got?.buffer.toString()).toBe('bytes');
    expect(got?.contentType).toBe('image/webp');
  });

  it('returns null for a missing key', async () => {
    expect(await new LocalImageStorage(dir).get('wiki/nope.webp')).toBeNull();
  });

  it('rejects keys that escape the base directory', async () => {
    await expect(new LocalImageStorage(dir).get('../etc/passwd')).rejects.toThrow();
  });
});

describe('put returns an app-served URL', () => {
  it('is /images/<key>, never a bucket URL', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'wiki-images-'));
    try {
      expect(await new LocalImageStorage(dir).put('wiki/x.webp', Buffer.from('a'), 'image/webp')).toBe('/images/wiki/x.webp');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('isServableImageKey', () => {
  it('allows only keys under the known prefixes', () => {
    expect(isServableImageKey(['wiki', 'abc.webp'])).toBe(true);
    expect(isServableImageKey(['tasks', 'abc.webp'])).toBe(true);
    expect(isServableImageKey(['other', 'abc.webp'])).toBe(false);
    expect(isServableImageKey(['abc.webp'])).toBe(false);
  });

  it('rejects traversal and odd segments', () => {
    expect(isServableImageKey(['wiki', '..', 'secret'])).toBe(false);
    expect(isServableImageKey(['wiki', '.hidden'])).toBe(false);
    expect(isServableImageKey(['wiki', 'a/b.webp'])).toBe(false);
    expect(isServableImageKey(['wiki', ''])).toBe(false);
  });
});
