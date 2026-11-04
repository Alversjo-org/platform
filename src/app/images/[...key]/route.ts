import { getImageStorage, isServableImageKey } from '@/lib/images/storage';
import { getSessionUser } from '@/lib/session';

/**
 * Serves stored images to logged-in members only. The bucket is private, so this route is the
 * only way in; the proxy also redirects visitors without a session cookie.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  if (!(await getSessionUser())) return new Response('Not signed in', { status: 401 });
  const { key } = await params;
  if (!isServableImageKey(key)) return new Response('Not found', { status: 404 });
  const image = await getImageStorage().get(key.join('/'));
  if (!image) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(image.buffer), {
    headers: {
      'Content-Type': image.contentType,
      // Private: members' browsers may cache, shared caches must not.
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
