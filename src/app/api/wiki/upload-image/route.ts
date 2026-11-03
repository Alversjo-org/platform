import { randomUUID } from 'node:crypto';
import { getImageStorage } from '@/lib/images/storage';
import { prepareImageUpload } from '@/lib/images/resize';
import { getSessionUser, hasAnyRole } from '@/lib/session';

const MAX_BYTES = 10 * 1024 * 1024;

/** Bridge for BlockNote's `uploadFile` hook. API route, so auth failures are status codes, not redirects. */
export async function POST(request: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Not signed in' }, { status: 401 });
  if (!hasAnyRole(user, ['admin', 'wiki-editor'])) return Response.json({ error: 'Not allowed' }, { status: 403 });

  const file = (await request.formData()).get('file');
  if (!(file instanceof File) || file.size === 0) return Response.json({ error: 'No file' }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: 'Image too large (max 10 MB)' }, { status: 413 });

  let prepared;
  try {
    prepared = await prepareImageUpload(Buffer.from(await file.arrayBuffer()));
  } catch {
    return Response.json({ error: 'Not a readable image' }, { status: 400 });
  }
  const url = await getImageStorage().put(`wiki/${randomUUID()}.webp`, prepared.buffer, prepared.contentType);
  return Response.json({ url });
}
