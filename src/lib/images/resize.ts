import sharp from 'sharp';

const MAX_WIDTH = 1600;

export async function prepareImageUpload(
  buffer: Buffer,
): Promise<{ buffer: Buffer; contentType: 'image/webp' }> {
  const out = await sharp(buffer)
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .webp()
    .toBuffer();
  return { buffer: out, contentType: 'image/webp' };
}
