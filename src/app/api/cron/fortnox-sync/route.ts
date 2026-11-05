import { getDb } from '@/db';
import { createFortnoxClient } from '@/lib/fortnox/client';
import { claimSyncRun, executeSyncRun } from '@/lib/fortnox/sync-service';

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  if (!secret || authHeader !== `Bearer ${secret}`) return new Response('unauthorized', { status: 401 });

  const db = await getDb();
  const runId = await claimSyncRun(db, 'nightly');
  if (!runId) return Response.json({ skipped: 'already_running' });

  const result = await executeSyncRun(db, createFortnoxClient(), runId);
  if (result.status === 'succeeded') return Response.json({ synced: result.years });
  if (result.status === 'needs_reauth') return Response.json({ error: 'needs_reauth' });
  return Response.json({ error: result.error }, { status: 500 });
}
