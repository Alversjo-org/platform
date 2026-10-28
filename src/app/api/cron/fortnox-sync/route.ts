import { getDb } from '@/db';
import { FortnoxApiError, createFortnoxClient } from '@/lib/fortnox/client';
import { getValidAccessToken, markNeedsReauth, NeedsReauthError } from '@/lib/fortnox/connection-service';
import { pickRecentFinancialYears, recordSyncCompletion, syncReferenceData, syncVouchersForYear } from '@/lib/fortnox/sync-service';

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  if (!secret || authHeader !== `Bearer ${secret}`) return new Response('unauthorized', { status: 401 });

  const db = await getDb();
  const client = createFortnoxClient();

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(db, client);
  } catch (error) {
    if (error instanceof NeedsReauthError) return Response.json({ error: 'needs_reauth' }, { status: 200 });
    throw error;
  }

  try {
    const financialYears = await client.getFinancialYears(accessToken);
    const yearsInScope = pickRecentFinancialYears(financialYears);

    for (const fy of yearsInScope) {
      // Reference data first: a voucher row can reference a cost centre or Fortnox project
      // created since the last sync, and fx_voucher_row has a real FK to both — syncing
      // vouchers before the codes they point at exist would abort the whole run.
      await syncReferenceData(db, client, accessToken, fy.fortnoxId);
      await syncVouchersForYear(db, client, accessToken, fy.fortnoxId);
    }

    await recordSyncCompletion(db);
    return Response.json({ synced: yearsInScope.map((fy) => fy.fortnoxId) });
  } catch (error) {
    if (error instanceof FortnoxApiError && error.status === 401) {
      await markNeedsReauth(db, error.message);
      return Response.json({ error: 'needs_reauth' }, { status: 200 });
    }
    throw error;
  }
}
