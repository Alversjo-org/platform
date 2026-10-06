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
});
