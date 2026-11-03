import { isHeic, openImage } from '@/lib/images/open';
import { ExpenseInputError, MAX_RECEIPT_BYTES, type ReceiptUpload } from './service';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

/**
 * Turns an uploaded file into what's stored and sent to Fortnox: photos are turned upright,
 * shrunk to at most 2400 px and re-encoded as JPEG (which also drops EXIF data such as GPS
 * position; iPhone HEIC photos become JPEGs too); PDFs are kept as they are.
 */
export async function prepareReceipt(file: File): Promise<ReceiptUpload> {
  if (file.size > MAX_RECEIPT_BYTES) throw new ExpenseInputError(`${file.name} is larger than 10 MB.`);
  const data = Buffer.from(await file.arrayBuffer());
  const baseName = (file.name || 'kvitto').replace(/\.[^.]+$/, '').slice(0, 150);
  if (file.type === 'application/pdf' || data.subarray(0, 5).toString() === '%PDF-') {
    return { fileName: `${baseName}.pdf`, contentType: 'application/pdf', data };
  }
  if (IMAGE_TYPES.includes(file.type) || file.type === '' || file.type.startsWith('image/') || isHeic(data)) {
    try {
      const jpeg = await (await openImage(data)).rotate().resize(2400, 2400, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
      return { fileName: `${baseName}.jpg`, contentType: 'image/jpeg', data: jpeg };
    } catch {
      throw new ExpenseInputError(`${file.name}: couldn’t read this image. Use a JPEG, PNG or HEIC photo, or a PDF.`);
    }
  }
  throw new ExpenseInputError(`${file.name}: use a photo (JPEG, PNG, HEIC) or a PDF.`);
}
