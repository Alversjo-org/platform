import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import type { FortnoxClient, FxNewVoucher, FxVoucherKey } from '@/lib/fortnox/client';
import { setBankAccount } from './bank-account-service';
import { parseBankDetails } from './bank-details';
import { bookExpense, bookPayout, outlayRows } from './booking';
import { cancelPaymentBatch, createPaymentBatch, downloadPaymentFile, getPaymentBatch, markPaymentBatchPaid } from './payments';
import {
  approveExpense, createExpense, defaultCostCentre, ExpenseInputError, ExpenseStateError, getExpense, listPayable,
  parseKronor, rejectExpense, withdrawExpense,
} from './service';
import { getExpenseSettings, updateExpenseSettings } from './settings';

const jpg = { fileName: 'kvitto.jpg', contentType: 'image/jpeg', data: Buffer.from('fake-jpeg') };

function fakeFortnox() {
  const vouchers: (FxNewVoucher & FxVoucherKey)[] = [];
  const uploads: string[] = [];
  const connections: { fileId: string; voucher: FxVoucherKey }[] = [];
  const series = new Set<string>();
  let failNextConnect = false;
  const client: FortnoxClient = {
    getAuthorizationUrl: () => '', exchangeCode: async () => { throw new Error(); }, refreshTokens: async () => { throw new Error(); },
    getFinancialYears: async () => [
      { fortnoxId: 6, fromDate: '2025-01-01', toDate: '2025-12-31', lockedUntilDate: null },
      { fortnoxId: 7, fromDate: '2026-01-01', toDate: '2026-12-31', lockedUntilDate: null },
    ],
    getAccounts: async () => [], getCostCentres: async () => [], getFxProjects: async () => [],
    listVoucherKeys: async () => [], getVoucher: async () => { throw new Error(); },
    ensureVoucherSeries: async (_t, code) => { series.add(code); },
    createVoucher: async (_t, year, v) => {
      const key = { year, series: v.series, number: vouchers.filter((x) => x.series === v.series).length + 1 };
      vouchers.push({ ...v, ...key });
      return key;
    },
    findVoucherByComment: async (_t, year, s, comments) => {
      const v = vouchers.find((x) => x.year === year && x.series === s && x.comments === comments);
      return v ? { year: v.year, series: v.series, number: v.number } : null;
    },
    uploadInboxFile: async (_t, f) => { uploads.push(f.fileName); return { fileId: `file-${uploads.length}` }; },
    connectFileToVoucher: async (_t, fileId, voucher) => {
      if (failNextConnect) { failNextConnect = false; throw new Error('Fortnox is down'); }
      connections.push({ fileId, voucher });
    },
  };
  return { client, vouchers, uploads, connections, series, failConnectOnce: () => { failNextConnect = true; } };
}

describe('outlays end to end', () => {
  let db: Db;
  const notify = vi.fn(async () => {});

  beforeEach(async () => {
    db = await createDb('pglite://memory');
    notify.mockClear();
    await db.insert(schema.user).values([
      { id: 'anna', email: 'anna@example.org', name: 'Anna Svensson' },
      { id: 'bo', email: 'bo@example.org', name: 'Bo Ek' },
      { id: 'treas', email: 'treasurer@example.org', name: 'Treasurer' },
    ]);
    await db.insert(schema.projectGroup).values({ id: 'g1', name: 'Bygg' });
    await db.insert(schema.project).values({ id: 'p1', slug: 'bastu', title: 'Bastu', kind: 'build', ownerUserId: 'anna', projectGroupId: 'g1' });
    await updateExpenseSettings(db, {
      debtorName: 'Föreningen Alversjö', debtorOrgNumber: '802000-0000', debtorIban: 'SE45 5000 0000 0583 9825 7466', debtorBic: 'ESSESESS',
      bankCustomerId: '', bankLedgerAccount: 1930, liabilityAccount: 2890, vatAccount: 2640, defaultCostAccount: 6990, outlaySeries: 'U', payoutSeries: 'UB',
    }, 'treas');
  });

  async function submit(userId = 'anna', totalOre = 12500, vatOre = 2500) {
    return createExpense(db, {
      userId, projectId: 'p1', description: 'Färg och penslar', merchant: 'Byggmax', purchaseDate: '2026-10-30',
      totalOre, vatOre, note: '', receipts: [jpg, { ...jpg, fileName: 'kvitto2.pdf', contentType: 'application/pdf' }],
    });
  }

  it('validates input', async () => {
    await expect(createExpense(db, { userId: 'anna', projectId: null, description: '', merchant: '', purchaseDate: '2026-10-30', totalOre: 100, vatOre: 0, note: '', receipts: [jpg] }))
      .rejects.toThrow(ExpenseInputError);
    await expect(createExpense(db, { userId: 'anna', projectId: null, description: 'x', merchant: '', purchaseDate: '2026-10-30', totalOre: 100, vatOre: 100, note: '', receipts: [jpg] }))
      .rejects.toThrow(/VAT/);
    await expect(createExpense(db, { userId: 'anna', projectId: null, description: 'x', merchant: '', purchaseDate: '2026-10-30', totalOre: 100, vatOre: 0, note: '', receipts: [] }))
      .rejects.toThrow(/receipt/);
    expect(parseKronor('1 234,50')).toBe(123450);
    expect(parseKronor('12.3')).toBe(1230);
    expect(parseKronor('abc')).toBeNull();
  });

  it('lets the member withdraw only while submitted, and the treasurer reject with a reason', async () => {
    const a = await submit();
    await expect(withdrawExpense(db, { id: a.id, userId: 'bo' })).rejects.toThrow(ExpenseStateError);
    await withdrawExpense(db, { id: a.id, userId: 'anna' });
    expect(await getExpense(db, a.id)).toBeNull();

    const b = await submit();
    await expect(rejectExpense(db, { id: b.id, actorUserId: 'treas', reason: ' ' }, notify)).rejects.toThrow(ExpenseInputError);
    await rejectExpense(db, { id: b.id, actorUserId: 'treas', reason: 'Receipt unreadable' }, notify);
    expect((await getExpense(db, b.id))?.status).toBe('rejected');
    expect(notify).toHaveBeenCalledWith('anna@example.org', expect.stringContaining('not approved'), expect.stringContaining('Receipt unreadable'));
    await expect(withdrawExpense(db, { id: b.id, userId: 'anna' })).rejects.toThrow(ExpenseStateError);
  });

  it('books the U voucher with VAT split, attaches the receipts, and never double-books on retry', async () => {
    const fx = fakeFortnox();
    const e = await submit();
    expect(await defaultCostCentre(db, 'p1')).toBeNull();
    await approveExpense(db, { id: e.id, actorUserId: 'treas', costAccount: 5460, costCentreCode: 'BYGG', fxProjectCode: null, bookVat: true }, notify);

    fx.failConnectOnce();
    const first = await bookExpense(db, fx.client, 'token', e.id);
    expect(first).toEqual({ ok: false, error: 'Fortnox is down' });
    let stored = await getExpense(db, e.id);
    expect(stored).toMatchObject({ voucherSeries: 'U', voucherNumber: 1, voucherYear: 7, bookingError: 'Fortnox is down' });

    expect(await bookExpense(db, fx.client, 'token', e.id)).toEqual({ ok: true });
    stored = await getExpense(db, e.id);
    expect(stored?.bookingError).toBeNull();
    expect(stored?.receipts.every((r) => r.connectedAt !== null)).toBe(true);
    expect(fx.vouchers).toHaveLength(1);
    expect(fx.uploads).toHaveLength(2); // the first upload's file id was kept for the retry
    expect(fx.connections.map((c) => c.voucher)).toEqual([{ year: 7, series: 'U', number: 1 }, { year: 7, series: 'U', number: 1 }]);
    expect(fx.series).toEqual(new Set(['U']));
    expect(fx.vouchers[0].rows).toEqual([
      { account: 5460, debitOre: 10000, creditOre: 0, costCentre: 'BYGG', project: null },
      { account: 2640, debitOre: 2500, creditOre: 0 },
      { account: 2890, debitOre: 0, creditOre: 12500, transactionInformation: 'Anna Svensson' },
    ]);

    // Lost the voucher number after Fortnox created it: found again by comment, not re-created.
    await db.update(schema.expense).set({ voucherNumber: null, voucherYear: null, voucherSeries: null }).where(eq(schema.expense.id, e.id));
    expect(await bookExpense(db, fx.client, 'token', e.id)).toEqual({ ok: true });
    expect(fx.vouchers).toHaveLength(1);
    expect((await getExpense(db, e.id))?.voucherNumber).toBe(1);
  });

  it('books everything on the cost account when VAT is not reclaimed', () => {
    expect(outlayRows({ totalOre: 12500, vatOre: 2500, bookVat: false, costAccount: 6990, vatAccount: 2640, liabilityAccount: 2890, costCentre: null, project: null, memberName: 'A' }))
      .toEqual([
        { account: 6990, debitOre: 12500, creditOre: 0, costCentre: null, project: null },
        { account: 2890, debitOre: 0, creditOre: 12500, transactionInformation: 'A' },
      ]);
  });

  it('pays booked outlays with a bank file, then books the payout', async () => {
    const fx = fakeFortnox();
    const a = await submit('anna', 12500, 2500);
    const b = await submit('bo', 5000, 0);
    for (const e of [a, b]) {
      await approveExpense(db, { id: e.id, actorUserId: 'treas', costAccount: 6990, costCentreCode: null, fxProjectCode: null, bookVat: true }, notify);
      await bookExpense(db, fx.client, 'token', e.id);
    }
    await setBankAccount(db, { userId: 'anna', actorUserId: 'anna', details: parseBankDetails({ kind: 'iban', holderName: 'Anna Svensson', iban: 'SE45 5000 0000 0583 9825 7466' }) }, notify);

    const payable = await listPayable(db);
    expect(payable.map((p) => [p.reference, p.hasBankAccount])).toEqual(expect.arrayContaining([[a.reference, true], [b.reference, false]]));
    const now = new Date('2026-11-03T09:00:00Z');
    await expect(createPaymentBatch(db, { actorUserId: 'treas', expenseIds: [a.id, b.id], executionDate: '2026-11-04', now })).rejects.toThrow(/bank account/);

    await setBankAccount(db, { userId: 'bo', actorUserId: 'bo', details: parseBankDetails({ kind: 'se', holderName: 'Bo Ek', clearing: '6123', account: '123456789' }) }, notify);
    const batch = await createPaymentBatch(db, { actorUserId: 'treas', expenseIds: [a.id, b.id], executionDate: '2026-11-04', now });
    expect(batch).toMatchObject({ status: 'exported', count: 2, totalOre: 17500 });
    expect(batch.fileEncrypted).not.toContain('123456789');
    expect(await listPayable(db)).toEqual([]);
    await expect(createPaymentBatch(db, { actorUserId: 'treas', expenseIds: [a.id], executionDate: '2026-11-04', now })).rejects.toThrow(ExpenseStateError);

    const file = await downloadPaymentFile(db, { batchId: batch.id, actorUserId: 'treas' });
    expect(file.fileName).toBe(`${batch.reference}.xml`);
    expect(file.xml).toContain('<CtrlSum>175.00</CtrlSum>');
    expect(file.xml).toContain('<Id>6123123456789</Id>');

    // Cancel puts them back; a new file takes them again.
    await cancelPaymentBatch(db, { batchId: batch.id, actorUserId: 'treas' });
    expect((await listPayable(db))).toHaveLength(2);
    const batch2 = await createPaymentBatch(db, { actorUserId: 'treas', expenseIds: [a.id, b.id], executionDate: '2026-11-05', now });

    await markPaymentBatchPaid(db, { batchId: batch2.id, actorUserId: 'treas', paidDate: '2026-11-05' }, notify);
    expect((await getExpense(db, a.id))?.status).toBe('paid');
    expect(notify).toHaveBeenCalledWith('bo@example.org', expect.stringContaining('paid'), expect.stringContaining('50,00 kr'));
    await expect(markPaymentBatchPaid(db, { batchId: batch2.id, actorUserId: 'treas', paidDate: '2026-11-05' }, notify)).rejects.toThrow(ExpenseStateError);

    expect(await bookPayout(db, fx.client, 'token', batch2.id)).toEqual({ ok: true });
    expect(await bookPayout(db, fx.client, 'token', batch2.id)).toEqual({ ok: true });
    const ub = fx.vouchers.filter((v) => v.series === 'UB');
    expect(ub).toHaveLength(1);
    expect(ub[0].transactionDate).toBe('2026-11-05');
    expect(ub[0].rows.map((r) => [r.account, r.debitOre, r.creditOre])).toEqual([
      [2890, a.reference < b.reference ? 12500 : 5000, 0],
      [2890, a.reference < b.reference ? 5000 : 12500, 0],
      [1930, 0, 17500],
    ]);
    expect((await getPaymentBatch(db, batch2.id))?.batch.voucherNumber).toBe(1);
  });

  it('validates settings', async () => {
    const s = await getExpenseSettings(db);
    expect(s.debtorIban).toBe('SE4550000000058398257466');
    await expect(updateExpenseSettings(db, { ...s, debtorIban: 'SE00 1234' }, 'treas')).rejects.toThrow(/IBAN/);
    await expect(updateExpenseSettings(db, { ...s, payoutSeries: 'U' }, 'treas')).rejects.toThrow(/different/);
  });
});
