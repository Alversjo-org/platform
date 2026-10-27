import { getDb } from '@/db';
import { createFortnoxClient } from '@/lib/fortnox/client';
import { getValidAccessToken, NeedsReauthError } from '@/lib/fortnox/connection-service';
import { syncVouchersForYear } from '@/lib/fortnox/sync-service';

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

  const financialYears = await client.getFinancialYears(accessToken);
  const today = new Date().toISOString().slice(0, 10);
  const currentYear = financialYears.find((fy) => fy.fromDate <= today && today <= fy.toDate) ?? financialYears[0];
  if (currentYear) await syncVouchersForYear(db, client, accessToken, currentYear.fortnoxId);

  return Response.json({ synced: currentYear?.fortnoxId ?? null });
}
