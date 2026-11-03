import { getDb } from '@/db';
import { getReceipt } from '@/lib/expenses/service';
import { getSessionUser, isTreasurer } from '@/lib/session';

/** A receipt file, for the member who sent it and the treasurer only. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const { id } = await params;
  const row = await getReceipt(await getDb(), id);
  if (!row || (row.ownerId !== user.id && !isTreasurer(user))) return new Response('Not found', { status: 404 });
  const { receipt } = row;
  return new Response(new Uint8Array(receipt.data), {
    headers: {
      'Content-Type': receipt.contentType,
      'Content-Disposition': `inline; filename="${receipt.fileName.replace(/[^\w.-]+/g, '_')}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
