import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { resizeAvatar } from './avatar';

describe('resizeAvatar', () => {
  it('returns a small 128x128 WebP data URL for a valid image', async () => {
    const input = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 10, g: 200, b: 80 } },
    }).png().toBuffer();

    const result = await resizeAvatar(input);
    expect(result).toMatch(/^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/);

    const base64 = result.slice('data:image/webp;base64,'.length);
    const bytes = Buffer.from(base64, 'base64');
    expect(bytes.length).toBeLessThan(20_000);

    const meta = await sharp(bytes).metadata();
    expect(meta).toMatchObject({ width: 128, height: 128, format: 'webp' });
  });

  it('throws for input that is not a decodable image', async () => {
    await expect(resizeAvatar(Buffer.from('not an image'))).rejects.toThrow();
  });

  it('corrects orientation for a photo with EXIF rotation, as mobile cameras produce', async () => {
    // Build a 64x64 "as the photographer saw it" image: red top half, blue bottom half.
    const red = Buffer.alloc(64 * 32 * 3);
    for (let i = 0; i < 64 * 32; i++) red.set([255, 0, 0], i * 3);
    const blue = Buffer.alloc(64 * 32 * 3);
    for (let i = 0; i < 64 * 32; i++) blue.set([0, 0, 255], i * 3);
    const upright = await sharp(Buffer.concat([red, blue]), {
      raw: { width: 64, height: 64, channels: 3 },
    })
      .jpeg()
      .toBuffer();

    // Simulate what a phone sensor stores for a photo taken rotated 90°: the raw
    // pixels are physically rotated, and an EXIF orientation tag records the
    // correction needed to display it upright.
    const sensorData = await sharp(upright).rotate(270).toBuffer();
    const input = await sharp(sensorData).withMetadata({ orientation: 6 }).jpeg().toBuffer();

    const result = await resizeAvatar(input);
    const bytes = Buffer.from(result.slice('data:image/webp;base64,'.length), 'base64');
    const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });

    const pixelAt = (x: number, y: number) => {
      const idx = (y * info.width + x) * info.channels;
      return [data[idx], data[idx + 1], data[idx + 2]];
    };

    // Correct orientation varies by row (top red, bottom blue) and is constant across columns.
    expect(pixelAt(32, 16)).toEqual(pixelAt(96, 16)); // both in the top half
    expect(pixelAt(32, 112)).toEqual(pixelAt(96, 112)); // both in the bottom half
    expect(pixelAt(64, 16)[0]).toBeGreaterThan(pixelAt(64, 16)[2]); // top is red-dominant
    expect(pixelAt(64, 112)[2]).toBeGreaterThan(pixelAt(64, 112)[0]); // bottom is blue-dominant
  });
});
