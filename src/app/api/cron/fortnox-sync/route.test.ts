import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import { FortnoxApiError, type FortnoxClient } from '@/lib/fortnox/client';
import { completeConnect } from '@/lib/fortnox/connection-service';

let db: Db;
let fakeClientImpl: FortnoxClient;

vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: async () => db }));
vi.mock('@/lib/fortnox/client', async (orig) => ({
  ...(await orig<typeof import('@/lib/fortnox/client')>()),
  createFortnoxClient: () => fakeClientImpl,
}));

const { POST } = await import('./route');

function baseClient(overrides: Partial<FortnoxClient> = {}): FortnoxClient {
  return {
    getAuthorizationUrl: () => '',
    exchangeCode: async () => ({ accessToken: 'at1', refreshToken: 'rt1', expiresAt: new Date(Date.now() + 3600_000), scope: 'bookkeeping' }),
    refreshTokens: async () => ({ accessToken: 'at1', refreshToken: 'rt1', expiresAt: new Date(Date.now() + 3600_000), scope: 'bookkeeping' }),
    getFinancialYears: async () => [{ fortnoxId: 1, fromDate: '2000-01-01', toDate: '2099-12-31', lockedUntilDate: null }],
    getAccounts: async () => [],
    getCostCentres: async () => [{ code: 'KOK', name: 'Kök', active: true }],
    getFxProjects: async () => [],
    listVoucherKeys: async () => [{ series: 'A', number: 1 }],
    getVoucher: async () => ({
      year: 1, series: 'A', number: 1, date: '2027-03-01', description: 'x', referenceType: null, referenceNumber: null, comments: null, hasAttachment: false,
      rows: [{ rowIndex: 1, account: 5460, debitSek: 100, creditSek: 0, costCentreCode: 'KOK', fxProjectCode: null, transactionInfo: null, removed: false }],
    }),
    ...overrides,
  };
}

describe('POST /api/cron/fortnox-sync', () => {
  beforeEach(async () => {
    db = await createDb('pglite://memory');
    process.env.CRON_SECRET = 'shh';
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
  });

  function request(): Request {
    return new Request('http://x', { method: 'POST', headers: { authorization: 'Bearer shh' } });
  }

  it('rejects without the correct bearer secret', async () => {
    const res = await POST(new Request('http://x', { headers: { authorization: 'Bearer wrong' } }));
    expect(res.status).toBe(401);
  });

  it('syncs reference data before vouchers, so a voucher referencing a brand-new cost centre does not abort the run', async () => {
    fakeClientImpl = baseClient();
    await completeConnect(db, fakeClientImpl, { code: 'c', userId: 'u1' });
    const res = await POST(request());
    expect(res.status).toBe(200);
    const [row] = await db.select().from(schema.fxVoucherRow);
    expect(row).toMatchObject({ costCentreCode: 'KOK' });
  });

  it('updates fx_sync_state after a successful sync', async () => {
    fakeClientImpl = baseClient();
    await completeConnect(db, fakeClientImpl, { code: 'c', userId: 'u1' });
    await POST(request());
    const [state] = await db.select().from(schema.fxSyncState).where(eq(schema.fxSyncState.topic, 'vouchers'));
    expect(state?.lastFullSyncAt).not.toBeNull();
  });

  it('marks the connection needs_reauth and returns 200 when Fortnox responds 401 mid-sync', async () => {
    fakeClientImpl = baseClient({ listVoucherKeys: async () => { throw new FortnoxApiError(401, '/vouchers', 'unauthorized'); } });
    await completeConnect(db, fakeClientImpl, { code: 'c', userId: 'u1' });
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ error: 'needs_reauth' });
    const [conn] = await db.select().from(schema.fortnoxConnection);
    expect(conn.status).toBe('needs_reauth');
  });
});
