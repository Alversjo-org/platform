'use server';

import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import { createFortnoxClient } from '@/lib/fortnox/client';
import { disconnect, getValidAccessToken, startConnect } from '@/lib/fortnox/connection-service';
import { runFirstImport } from '@/lib/fortnox/sync-service';
import { requireTreasurer } from '@/lib/session';

export async function connectAction(): Promise<void> {
  await requireTreasurer();
  const state = randomUUID();
  (await cookies()).set('fortnox_oauth_state', state, { httpOnly: true, sameSite: 'lax', maxAge: 600, path: '/' });
  redirect(startConnect(createFortnoxClient(), state));
}

export async function runFirstImportAction(): Promise<void> {
  await requireTreasurer();
  const db = await getDb();
  const client = createFortnoxClient();
  const accessToken = await getValidAccessToken(db, client);
  await runFirstImport(db, client, accessToken);
  redirect('/fortnox');
}

export async function disconnectAction(): Promise<void> {
  await requireTreasurer();
  await disconnect(await getDb());
  redirect('/fortnox');
}
