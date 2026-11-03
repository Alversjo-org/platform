import { getDb } from '@/db';
import { downloadPaymentFile } from '@/lib/expenses/payments';
import { ExpenseStateError } from '@/lib/expenses/service';
import { getSessionUser, isTreasurer } from '@/lib/session';

/** The pain.001 file for the bank. Treasurer only; each download is logged. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user || !isTreasurer(user)) return new Response('Not found', { status: 404 });
  const { id } = await params;
  try {
    const { fileName, xml } = await downloadPaymentFile(await getDb(), { batchId: id, actorUserId: user.id });
    return new Response(xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    if (e instanceof ExpenseStateError) return new Response('Not found', { status: 404 });
    throw e;
  }
}
