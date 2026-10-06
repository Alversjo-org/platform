import sharp from 'sharp';

const AVATAR_SIZE = 128;

/** Decodes, crops-to-square and resizes an uploaded image, returning it as a small WebP data URL ready to store. Throws for anything sharp cannot decode. */
export async function resizeAvatar(buffer: Buffer): Promise<string> {
  const resized = await sharp(buffer)
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' })
    .webp({ quality: 80 })
    .toBuffer();
  return `data:image/webp;base64,${resized.toString('base64')}`;
}
