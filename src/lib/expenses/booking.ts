import { and, asc, eq, isNull } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { FortnoxClient, FxNewVoucherRow, FxVoucherKey } from '@/lib/fortnox/client';
import { getExpenseSettings } from './settings';

/**
 * Books outlays in Fortnox, in two steps (the reference note's choice, docs/superpowers/specs/
 * 2026-10-15-projects-events-cobudgeting-reference.md):
 *
 * - At approval, series U: cost (excl. VAT) + input VAT 2640, credit 2890 "owed to the member".
 *   The receipts are uploaded to the voucher inbox and attached to that voucher.
 * - When the bank has paid a payment file, series UB: debit 2890 per outlay, credit the bank.
 *
 * Every step is safe to retry: a voucher is first looked up by its comment (written at creation),
 * so a crash between "Fortnox created it" and "we saved its number" never books twice; receipts
 * remember their Fortnox file id and whether they're attached.
 */

export class BookingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BookingError';
  }
}

export function expenseVoucherComment(expenseId: string): string {
  return `alversjo-expense:${expenseId}`;
}

export function payoutVoucherComment(batchId: string): string {
  return `alversjo-payout:${batchId}`;
}

async function financialYearIdFor(client: FortnoxClient, accessToken: string, date: string): Promise<number> {
  const years = await client.getFinancialYears(accessToken);
  const year = years.find((y) => y.fromDate <= date && date <= y.toDate);
  if (!year) throw new BookingError(`Fortnox has no financial year containing ${date}.`);
  return year.fortnoxId;
}

/** The U-voucher rows for an outlay. */
export function outlayRows(input: {
  totalOre: number; vatOre: number; bookVat: boolean; costAccount: number; vatAccount: number; liabilityAccount: number;
  costCentre: string | null; project: string | null; memberName: string;
}): FxNewVoucherRow[] {
  const vat = input.bookVat ? input.vatOre : 0;
  const rows: FxNewVoucherRow[] = [
    { account: input.costAccount, debitOre: input.totalOre - vat, creditOre: 0, costCentre: input.costCentre, project: input.project },
  ];
  if (vat > 0) rows.push({ account: input.vatAccount, debitOre: vat, creditOre: 0 });
  rows.push({ account: input.liabilityAccount, debitOre: 0, creditOre: input.totalOre, transactionInformation: input.memberName });
  return rows;
}

/**
 * Books one approved outlay and attaches its receipts. Records the outcome on the outlay
 * (voucher or bookingError) instead of throwing, so a page can show and retry it.
 */
export async function bookExpense(db: Db, client: FortnoxClient, accessToken: string, expenseId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const [row] = await db.select({ expense: schema.expense, memberName: schema.user.name, memberEmail: schema.user.email })
      .from(schema.expense).innerJoin(schema.user, eq(schema.user.id, schema.expense.userId))
      .where(eq(schema.expense.id, expenseId));
    if (!row) throw new BookingError('Outlay not found.');
    const e = row.expense;
    if (e.status !== 'approved' && e.status !== 'paid') throw new BookingError('Only an approved outlay can be booked.');
    if (e.costAccount === null) throw new BookingError('The outlay has no cost account.');
    const settings = await getExpenseSettings(db);

    let voucher: FxVoucherKey | null = e.voucherNumber !== null && e.voucherYear !== null && e.voucherSeries
      ? { year: e.voucherYear, series: e.voucherSeries, number: e.voucherNumber }
      : null;

    if (!voucher) {
      const yearId = await financialYearIdFor(client, accessToken, e.purchaseDate);
      await client.ensureVoucherSeries(accessToken, settings.outlaySeries, 'Utlägg');
      const comment = expenseVoucherComment(e.id);
      voucher = await client.findVoucherByComment(accessToken, yearId, settings.outlaySeries, comment);
      if (!voucher) {
        const memberName = row.memberName || row.memberEmail;
        voucher = await client.createVoucher(accessToken, yearId, {
          series: settings.outlaySeries,
          transactionDate: e.purchaseDate,
          description: `Utlägg ${e.reference} ${memberName}: ${e.description}`,
          comments: comment,
          rows: outlayRows({
            totalOre: e.totalOre, vatOre: e.vatOre, bookVat: e.bookVat, costAccount: e.costAccount,
            vatAccount: settings.vatAccount, liabilityAccount: settings.liabilityAccount,
            costCentre: e.costCentreCode, project: e.fxProjectCode, memberName,
          }),
        });
      }
      await db.update(schema.expense)
        .set({ voucherYear: voucher.year, voucherSeries: voucher.series, voucherNumber: voucher.number, bookedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.expense.id, e.id));
    }

    const receipts = await db.select().from(schema.expenseReceipt)
      .where(and(eq(schema.expenseReceipt.expenseId, e.id), isNull(schema.expenseReceipt.connectedAt)))
      .orderBy(asc(schema.expenseReceipt.createdAt));
    for (const r of receipts) {
      let fileId = r.fortnoxFileId;
      if (!fileId) {
        const ext = r.contentType === 'application/pdf' ? 'pdf' : r.contentType.split('/')[1] ?? 'bin';
        const name = `${e.reference}-${r.id.slice(0, 4)}.${ext === 'jpeg' ? 'jpg' : ext}`;
        fileId = (await client.uploadInboxFile(accessToken, { fileName: name, contentType: r.contentType, data: r.data })).fileId;
        await db.update(schema.expenseReceipt).set({ fortnoxFileId: fileId }).where(eq(schema.expenseReceipt.id, r.id));
      }
      await client.connectFileToVoucher(accessToken, fileId, voucher);
      await db.update(schema.expenseReceipt).set({ connectedAt: new Date() }).where(eq(schema.expenseReceipt.id, r.id));
    }

    await db.update(schema.expense).set({ bookingError: null, updatedAt: new Date() }).where(eq(schema.expense.id, e.id));
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(schema.expense).set({ bookingError: message.slice(0, 1000), updatedAt: new Date() }).where(eq(schema.expense.id, expenseId));
    return { ok: false, error: message };
  }
}

/** Books a paid payment file: clears each member's 2890 balance against the bank account. */
export async function bookPayout(db: Db, client: FortnoxClient, accessToken: string, batchId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const [batch] = await db.select().from(schema.paymentBatch).where(eq(schema.paymentBatch.id, batchId));
    if (!batch) throw new BookingError('Payment file not found.');
    if (batch.status !== 'paid' || !batch.paidAt) throw new BookingError('Mark the payment file as paid first.');
    if (batch.voucherNumber !== null) return { ok: true };
    const settings = await getExpenseSettings(db);
    const items = await db.select({ expense: schema.expense, memberName: schema.user.name, memberEmail: schema.user.email })
      .from(schema.expense).innerJoin(schema.user, eq(schema.user.id, schema.expense.userId))
      .where(eq(schema.expense.paymentBatchId, batchId)).orderBy(asc(schema.expense.reference));
    if (items.length === 0) throw new BookingError('The payment file has no outlays.');

    const yearId = await financialYearIdFor(client, accessToken, batch.paidAt);
    await client.ensureVoucherSeries(accessToken, settings.payoutSeries, 'Utbetalning utlägg');
    const comment = payoutVoucherComment(batch.id);
    let voucher = await client.findVoucherByComment(accessToken, yearId, settings.payoutSeries, comment);
    if (!voucher) {
      const total = items.reduce((s, i) => s + i.expense.totalOre, 0);
      voucher = await client.createVoucher(accessToken, yearId, {
        series: settings.payoutSeries,
        transactionDate: batch.paidAt,
        description: `Utbetalning utlägg ${batch.reference} (${items.length} st)`,
        comments: comment,
        rows: [
          ...items.map((i) => ({
            account: settings.liabilityAccount, debitOre: i.expense.totalOre, creditOre: 0,
            transactionInformation: `${i.expense.reference} ${i.memberName || i.memberEmail}`,
          })),
          { account: settings.bankLedgerAccount, debitOre: 0, creditOre: total, transactionInformation: batch.reference },
        ],
      });
    }
    await db.update(schema.paymentBatch)
      .set({ voucherYear: voucher.year, voucherSeries: voucher.series, voucherNumber: voucher.number, bookingError: null })
      .where(eq(schema.paymentBatch.id, batch.id));
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(schema.paymentBatch).set({ bookingError: message.slice(0, 1000) }).where(eq(schema.paymentBatch.id, batchId));
    return { ok: false, error: message };
  }
}
