import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { prepareImageUpload } from './resize';

describe('prepareImageUpload', () => {
  it('re-encodes to webp and caps width at 1600px', async () => {
    const wide = await sharp({ create: { width: 2000, height: 100, channels: 3, background: 'red' } }).png().toBuffer();
    const { buffer, contentType } = await prepareImageUpload(wide);
    expect(contentType).toBe('image/webp');
    const meta = await sharp(buffer).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(1600);
  });

  it('leaves an already-narrow image at its original width', async () => {
    const narrow = await sharp({ create: { width: 400, height: 100, channels: 3, background: 'blue' } }).png().toBuffer();
    const { buffer } = await prepareImageUpload(narrow);
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(400);
  });

  it('rejects a buffer that is not a decodable image', async () => {
    await expect(prepareImageUpload(Buffer.from('not an image'))).rejects.toThrow();
  });
});
