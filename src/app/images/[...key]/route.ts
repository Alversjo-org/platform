import { readFile } from 'node:fs/promises';
import { DEFAULT_LOCAL_IMAGE_DIR, resolveImagePath } from '@/lib/images/storage';

// Dev/local-storage only: production images are served by Tigris directly.
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  try {
    const file = resolveImagePath(DEFAULT_LOCAL_IMAGE_DIR, key.join('/'));
    const data = await readFile(file);
    return new Response(new Uint8Array(data), {
      headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=3600' },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
