import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import type { FortnoxClient } from './client';
import { pickRecentFinancialYears, runFirstImport, syncReferenceData, syncVouchersForYear } from './sync-service';

function fakeClient(overrides: Partial<FortnoxClient> = {}): FortnoxClient {
  return {
    getAuthorizationUrl: (state) => `https://apps.fortnox.se/oauth-v1/auth?state=${state}`,
    exchangeCode: async () => { throw new Error('not used'); },
    refreshTokens: async () => { throw new Error('not used'); },
    getFinancialYears: async () => [
      { fortnoxId: 2, fromDate: '2027-01-01', toDate: '2027-12-31', lockedUntilDate: null },
      { fortnoxId: 1, fromDate: '2026-01-01', toDate: '2026-12-31', lockedUntilDate: null },
    ],
    getAccounts: async () => [],
    getCostCentres: async () => [],
    getFxProjects: async () => [],
    listVoucherKeys: async () => [],
    getVoucher: async () => { throw new Error('not used'); },
    ...overrides,
  };
}

describe('pickRecentFinancialYears', () => {
  it('picks the year containing today and the one before it, near a year boundary', () => {
    const thisYear = new Date().getUTCFullYear();
    const years = [
      { fortnoxId: 3, fromDate: `${thisYear + 1}-01-01`, toDate: `${thisYear + 1}-12-31`, lockedUntilDate: null },
      { fortnoxId: 2, fromDate: `${thisYear}-01-01`, toDate: `${thisYear}-12-31`, lockedUntilDate: null },
      { fortnoxId: 1, fromDate: `${thisYear - 1}-01-01`, toDate: `${thisYear - 1}-12-31`, lockedUntilDate: null },
    ];
    expect(pickRecentFinancialYears(years).map((fy) => fy.fortnoxId)).toEqual([2, 1]);
  });

  it('falls back to the two most recent years when none contains today', () => {
    const years = [
      { fortnoxId: 2, fromDate: '2000-01-01', toDate: '2000-12-31', lockedUntilDate: null },
      { fortnoxId: 1, fromDate: '1999-01-01', toDate: '1999-12-31', lockedUntilDate: null },
    ];
    expect(pickRecentFinancialYears(years).map((fy) => fy.fortnoxId)).toEqual([2, 1]);
  });
});

describe('sync-service', () => {
  it('syncReferenceData upserts cost centres and fx projects, idempotently', async () => {
    const db: Db = await createDb('pglite://memory');
    const client = fakeClient({ getCostCentres: async () => [{ code: 'INFRA', name: 'Infrastructure', active: true }] });
    await syncReferenceData(db, client, 'tok', 2027);
    await syncReferenceData(db, client, 'tok', 2027); // repeat
    const rows = await db.select().from(schema.fxCostCentre);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: 'INFRA', name: 'Infrastructure' });
  });

  it('syncVouchersForYear inserts a voucher and its rows', async () => {
    const db: Db = await createDb('pglite://memory');
    const client = fakeClient({
      listVoucherKeys: async () => [{ series: 'A', number: 1 }],
      getVoucher: async () => ({
        year: 2027, series: 'A', number: 1, date: '2027-03-01', description: 'Biltema', referenceType: null, referenceNumber: null, comments: null, hasAttachment: false,
        rows: [{ rowIndex: 1, account: 5460, debitSek: 10000, creditSek: 0, costCentreCode: null, fxProjectCode: null, transactionInfo: 'Biltema AB', removed: false }],
      }),
    });
    await syncVouchersForYear(db, client, 'tok', 2027);
    const [voucher] = await db.select().from(schema.fxVoucher);
    expect(voucher).toMatchObject({ year: 2027, series: 'A', number: 1, description: 'Biltema' });
    const rows = await db.select().from(schema.fxVoucherRow).where(eq(schema.fxVoucherRow.voucherId, voucher.id));
    expect(rows).toMatchObject([{ account: 5460, debitSek: 10000, removed: false }]);
  });

  it('re-syncing the same voucher after an Ändra edit marks the struck row removed and adds the new one, without duplicating', async () => {
    const db: Db = await createDb('pglite://memory');
    const original = {
      year: 2027, series: 'A', number: 1, date: '2027-03-01', description: 'Biltema', referenceType: null, referenceNumber: null, comments: null, hasAttachment: false,
      rows: [{ rowIndex: 1, account: 5460, debitSek: 10000, creditSek: 0, costCentreCode: null, fxProjectCode: null, transactionInfo: 'Biltema AB', removed: false }],
    };
    const edited = {
      ...original,
      rows: [
        { ...original.rows[0], removed: true },
        { rowIndex: 2, account: 5460, debitSek: 10000, creditSek: 0, costCentreCode: null, fxProjectCode: null, transactionInfo: 'Biltema AB (corrected)', removed: false },
      ],
    };
    let voucher = original;
    const client = fakeClient({ listVoucherKeys: async () => [{ series: 'A', number: 1 }], getVoucher: async () => voucher });
    await syncVouchersForYear(db, client, 'tok', 2027);
    voucher = edited;
    await syncVouchersForYear(db, client, 'tok', 2027);
    const [v] = await db.select().from(schema.fxVoucher);
    const rows = await db.select().from(schema.fxVoucherRow).where(eq(schema.fxVoucherRow.voucherId, v.id));
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.rowIndex === 1)?.removed).toBe(true);
    expect(rows.find((r) => r.rowIndex === 2)?.transactionInfo).toBe('Biltema AB (corrected)');
  });

  it('syncing the same voucher concurrently (e.g. a manual import overlapping the nightly job) does not create duplicate rows', async () => {
    const db: Db = await createDb('pglite://memory');
    const client = fakeClient({
      listVoucherKeys: async () => [{ series: 'A', number: 1 }],
      getVoucher: async () => ({
        year: 2027, series: 'A', number: 1, date: '2027-03-01', description: 'Biltema', referenceType: null, referenceNumber: null, comments: null, hasAttachment: false,
        rows: [{ rowIndex: 1, account: 5460, debitSek: 10000, creditSek: 0, costCentreCode: null, fxProjectCode: null, transactionInfo: 'Biltema AB', removed: false }],
      }),
    });
    await Promise.all([
      syncVouchersForYear(db, client, 'tok', 2027),
      syncVouchersForYear(db, client, 'tok', 2027),
    ]);
    expect(await db.select().from(schema.fxVoucher)).toHaveLength(1);
    const [voucher] = await db.select().from(schema.fxVoucher);
    expect(await db.select().from(schema.fxVoucherRow).where(eq(schema.fxVoucherRow.voucherId, voucher.id))).toHaveLength(1);
  });

  it('a voucher that comes back with fewer rows than last synced marks the missing row removed instead of leaving it live', async () => {
    const db: Db = await createDb('pglite://memory');
    const twoRows = {
      year: 2027, series: 'A', number: 1, date: '2027-03-01', description: 'Biltema', referenceType: null, referenceNumber: null, comments: null, hasAttachment: false,
      rows: [
        { rowIndex: 1, account: 5460, debitSek: 10000, creditSek: 0, costCentreCode: null, fxProjectCode: null, transactionInfo: 'Biltema AB', removed: false },
        { rowIndex: 2, account: 2640, debitSek: 2500, creditSek: 0, costCentreCode: null, fxProjectCode: null, transactionInfo: 'VAT', removed: false },
      ],
    };
    const oneRow = { ...twoRows, rows: [twoRows.rows[0]] };
    let voucher = twoRows;
    const client = fakeClient({ listVoucherKeys: async () => [{ series: 'A', number: 1 }], getVoucher: async () => voucher });
    await syncVouchersForYear(db, client, 'tok', 2027);
    voucher = oneRow;
    await syncVouchersForYear(db, client, 'tok', 2027);
    const [v] = await db.select().from(schema.fxVoucher);
    const rows = await db.select().from(schema.fxVoucherRow).where(eq(schema.fxVoucherRow.voucherId, v.id));
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.rowIndex === 1)?.removed).toBe(false);
    expect(rows.find((r) => r.rowIndex === 2)?.removed).toBe(true);
  });

  it('running the first import twice is idempotent', async () => {
    const db: Db = await createDb('pglite://memory');
    const client = fakeClient({
      listVoucherKeys: async () => [{ series: 'A', number: 1 }],
      getVoucher: async () => ({ year: 2027, series: 'A', number: 1, date: '2027-03-01', description: 'X', referenceType: null, referenceNumber: null, comments: null, hasAttachment: false, rows: [] }),
    });
    await runFirstImport(db, client, 'tok');
    await runFirstImport(db, client, 'tok');
    expect(await db.select().from(schema.fxVoucher)).toHaveLength(1);
  });
});
