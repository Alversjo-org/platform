import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { isHeic, openImage } from './open';

// 64×48, red top half, blue bottom half; made with macOS `sips -s format heic`.
const heic = readFileSync(new URL('./fixtures/two-tone.heic', import.meta.url));

describe('openImage', () => {
  it('recognises a HEIC file by its ftyp box', async () => {
    expect(isHeic(heic)).toBe(true);
    expect(isHeic(await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).png().toBuffer())).toBe(false);
    expect(isHeic(Buffer.from('not an image'))).toBe(false);
  });

  it('decodes a HEIC photo that sharp alone cannot read', async () => {
    await expect(sharp(heic).toBuffer()).rejects.toThrow();
    const jpeg = await (await openImage(heic)).jpeg().toBuffer();
    expect(await sharp(jpeg).metadata()).toMatchObject({ format: 'jpeg', width: 64, height: 48 });
    const { data } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
    const top = data.subarray(0, 3);
    const bottom = data.subarray(data.length - 3);
    expect(top[0]).toBeGreaterThan(200);
    expect(bottom[2]).toBeGreaterThan(200);
  });

  it('passes other formats straight to sharp', async () => {
    const png = await sharp({ create: { width: 10, height: 6, channels: 3, background: '#0a0' } }).png().toBuffer();
    expect(await (await openImage(png)).metadata()).toMatchObject({ format: 'png', width: 10, height: 6 });
  });
});
