import { openImage } from '@/lib/images/open';

const AVATAR_SIZE = 128;

/** Decodes, crops-to-square and resizes an uploaded image, returning it as a small WebP data URL ready to store. Reads HEIC too. Throws for anything it cannot decode. */
export async function resizeAvatar(buffer: Buffer): Promise<string> {
  const resized = await (await openImage(buffer))
    .rotate() // apply EXIF orientation (e.g. mobile photos) before cropping/resizing
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' })
    .webp({ quality: 80 })
    .toBuffer();
  return `data:image/webp;base64,${resized.toString('base64')}`;
}
