import { describe, expect, it, vi } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import type { FortnoxClient } from './client';
import { completeConnect, disconnect, getConnection, getValidAccessToken, NeedsReauthError } from './connection-service';

async function seedUser(db: Db, id: string): Promise<void> {
  await db.insert(schema.user).values({ id, email: `${id}@example.org` });
}

function fakeClient(overrides: Partial<FortnoxClient> = {}): FortnoxClient {
  return {
    getAuthorizationUrl: (state) => `https://apps.fortnox.se/oauth-v1/auth?state=${state}`,
    exchangeCode: async () => ({ accessToken: 'at1', refreshToken: 'rt1', expiresAt: new Date(Date.now() + 3600_000), scope: 'bookkeeping' }),
    refreshTokens: async () => ({ accessToken: 'at2', refreshToken: 'rt2', expiresAt: new Date(Date.now() + 3600_000), scope: 'bookkeeping' }),
    getFinancialYears: async () => [], getAccounts: async () => [], getCostCentres: async () => [], getFxProjects: async () => [],
    listVoucherKeys: async () => [], getVoucher: async () => { throw new Error('not used'); },
    ...overrides,
  };
}

describe('connection-service', () => {
  let db: Db;

  it('completeConnect stores the exchanged tokens as connected', async () => {
    db = await createDb('pglite://memory');
    await seedUser(db, 'u1');
    await completeConnect(db, fakeClient(), { code: 'abc', userId: 'u1' });
    const conn = await getConnection(db);
    expect(conn).toMatchObject({ status: 'connected', accessToken: 'at1', refreshToken: 'rt1', connectedByUserId: 'u1' });
  });

  it('getValidAccessToken returns the stored token when not near expiry', async () => {
    db = await createDb('pglite://memory');
    await seedUser(db, 'u1');
    const client = fakeClient();
    await completeConnect(db, client, { code: 'abc', userId: 'u1' });
    const refreshSpy = vi.spyOn(client, 'refreshTokens');
    const token = await getValidAccessToken(db, client);
    expect(token).toBe('at1');
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it('getValidAccessToken refreshes and persists when near expiry', async () => {
    db = await createDb('pglite://memory');
    await seedUser(db, 'u1');
    const client = fakeClient({ exchangeCode: async () => ({ accessToken: 'at1', refreshToken: 'rt1', expiresAt: new Date(Date.now() + 60_000), scope: 'bookkeeping' }) });
    await completeConnect(db, client, { code: 'abc', userId: 'u1' });
    const token = await getValidAccessToken(db, client);
    expect(token).toBe('at2');
    const conn = await getConnection(db);
    expect(conn).toMatchObject({ accessToken: 'at2', refreshToken: 'rt2' });
  });

  it('two concurrent near-expiry calls only refresh once', async () => {
    db = await createDb('pglite://memory');
    await seedUser(db, 'u1');
    let refreshCalls = 0;
    const client = fakeClient({
      exchangeCode: async () => ({ accessToken: 'at1', refreshToken: 'rt1', expiresAt: new Date(Date.now() + 60_000), scope: 'bookkeeping' }),
      refreshTokens: async () => { refreshCalls++; return { accessToken: 'at2', refreshToken: 'rt2', expiresAt: new Date(Date.now() + 3600_000), scope: 'bookkeeping' }; },
    });
    await completeConnect(db, client, { code: 'abc', userId: 'u1' });
    const [a, b] = await Promise.all([getValidAccessToken(db, client), getValidAccessToken(db, client)]);
    expect(refreshCalls).toBe(1);
    expect(a).toBe('at2');
    expect(b).toBe('at2');
  });

  it('a failed refresh marks the connection needs_reauth and keeps the stale tokens', async () => {
    db = await createDb('pglite://memory');
    await seedUser(db, 'u1');
    const client = fakeClient({
      exchangeCode: async () => ({ accessToken: 'at1', refreshToken: 'rt1', expiresAt: new Date(Date.now() + 60_000), scope: 'bookkeeping' }),
      refreshTokens: async () => { throw new Error('invalid_grant'); },
    });
    await completeConnect(db, client, { code: 'abc', userId: 'u1' });
    await expect(getValidAccessToken(db, client)).rejects.toBeInstanceOf(NeedsReauthError);
    const conn = await getConnection(db);
    expect(conn).toMatchObject({ status: 'needs_reauth', accessToken: 'at1', refreshToken: 'rt1' });
    expect(conn?.lastRefreshError).toMatch(/invalid_grant/);
  });

  it('disconnect sets status to disconnected', async () => {
    db = await createDb('pglite://memory');
    await seedUser(db, 'u1');
    await completeConnect(db, fakeClient(), { code: 'abc', userId: 'u1' });
    await disconnect(db);
    expect((await getConnection(db))?.status).toBe('disconnected');
  });
});
