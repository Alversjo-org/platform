import decodeHeic from 'heic-decode';
import sharp, { type Sharp } from 'sharp';

// The major brands iPhones and other cameras write in a HEIC file's `ftyp` box.
const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'];

export function isHeic(data: Buffer): boolean {
  return data.subarray(4, 8).toString('latin1') === 'ftyp' && HEIC_BRANDS.includes(data.subarray(8, 12).toString('latin1'));
}

/**
 * Opens an uploaded photo for sharp. sharp's prebuilt binaries can't read HEIC (they leave out
 * the HEVC codec), so HEIC photos are decoded to raw pixels first; libheif applies the photo's
 * rotation while decoding. Anything else, AVIF included, goes straight to sharp.
 */
export async function openImage(data: Buffer): Promise<Sharp> {
  if (isHeic(data)) {
    const { width, height, data: pixels } = await decodeHeic({ buffer: data });
    return sharp(Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength), { raw: { width, height, channels: 4 } });
  }
  return sharp(data);
}
