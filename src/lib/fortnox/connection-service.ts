import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { FortnoxClient } from './client';

const REFRESH_BUFFER_MS = 2 * 60 * 1000;

export class NeedsReauthError extends Error {
  constructor() { super('Fortnox connection needs re-authorization'); this.name = 'NeedsReauthError'; }
}

export function startConnect(client: FortnoxClient, state: string): string {
  return client.getAuthorizationUrl(state);
}

export async function completeConnect(db: Db, client: FortnoxClient, input: { code: string; userId: string }): Promise<void> {
  const tokens = await client.exchangeCode(input.code);
  await db.insert(schema.fortnoxConnection).values({
    id: randomUUID(),
    status: 'connected',
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: tokens.expiresAt,
    refreshToken: tokens.refreshToken,
    scope: tokens.scope,
    connectedByUserId: input.userId,
    connectedAt: new Date(),
  });
}

export async function disconnect(db: Db): Promise<void> {
  const conn = await getConnection(db);
  if (!conn) return;
  await db.update(schema.fortnoxConnection).set({ status: 'disconnected', updatedAt: new Date() }).where(eq(schema.fortnoxConnection.id, conn.id));
}

export async function getConnection(db: Db): Promise<typeof schema.fortnoxConnection.$inferSelect | null> {
  const [row] = await db.select().from(schema.fortnoxConnection).orderBy(desc(schema.fortnoxConnection.updatedAt)).limit(1);
  return row ?? null;
}

export async function getValidAccessToken(db: Db, client: FortnoxClient): Promise<string> {
  // A thrown error inside db.transaction() rolls back everything written in it, including
  // the needs_reauth update below — so the failure path returns a marker and throws after
  // the transaction has committed, instead of throwing from inside it.
  const result = await db.transaction(async (tx) => {
    const [conn] = await tx.select().from(schema.fortnoxConnection).orderBy(desc(schema.fortnoxConnection.updatedAt)).limit(1).for('update');
    if (!conn || conn.status !== 'connected' || !conn.refreshToken || !conn.accessToken) {
      return { ok: false as const };
    }

    if (conn.accessTokenExpiresAt && conn.accessTokenExpiresAt.getTime() - Date.now() > REFRESH_BUFFER_MS) {
      return { ok: true as const, accessToken: conn.accessToken };
    }

    try {
      const tokens = await client.refreshTokens(conn.refreshToken);
      await tx.update(schema.fortnoxConnection).set({
        accessToken: tokens.accessToken,
        accessTokenExpiresAt: tokens.expiresAt,
        refreshToken: tokens.refreshToken,
        scope: tokens.scope,
        lastRefreshedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(schema.fortnoxConnection.id, conn.id));
      return { ok: true as const, accessToken: tokens.accessToken };
    } catch (error) {
      await tx.update(schema.fortnoxConnection).set({
        status: 'needs_reauth',
        lastRefreshError: String(error),
        updatedAt: new Date(),
      }).where(eq(schema.fortnoxConnection.id, conn.id));
      return { ok: false as const };
    }
  });

  if (!result.ok) throw new NeedsReauthError();
  return result.accessToken;
}
