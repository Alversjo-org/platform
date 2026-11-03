import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { PaymentBatch } from '@/db/schema';
import { logDecision } from '@/lib/decision-log';
import type { Notify } from './bank-account-service';
import { readBankDetails } from './bank-account-service';
import { decryptText, encryptText } from './bank-crypto';
import { buildPain001, type Pain001Payment } from './pain001';
import { ExpenseInputError, ExpenseStateError, newReference } from './service';
import { getExpenseSettings } from './settings';

/**
 * Payment files (pain.001) for approved, booked outlays. Lifecycle of a file:
 * exported (downloaded, to be uploaded and signed in the bank) → paid (the treasurer confirms
 * the bank paid it; outlays become paid and the UB voucher is booked) or cancelled (the outlays
 * go back to the "to pay" list). An outlay is in at most one live file.
 */

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
}

export async function createPaymentBatch(
  db: Db,
  input: { actorUserId: string; expenseIds: string[]; executionDate: string; now?: Date },
): Promise<PaymentBatch> {
  const ids = [...new Set(input.expenseIds)];
  if (ids.length === 0) throw new ExpenseInputError('Choose at least one outlay to pay.');
  if (!isIsoDate(input.executionDate)) throw new ExpenseInputError('Choose a payment date.');
  const now = input.now ?? new Date();
  if (input.executionDate < now.toISOString().slice(0, 10)) throw new ExpenseInputError('The payment date is in the past.');
  const settings = await getExpenseSettings(db);

  const rows = await db.select({ expense: schema.expense }).from(schema.expense)
    .where(and(inArray(schema.expense.id, ids), eq(schema.expense.status, 'approved'), isNull(schema.expense.paymentBatchId)));
  if (rows.length !== ids.length) throw new ExpenseStateError('Some of the chosen outlays are no longer waiting for payment. Reload and try again.');

  const payments: Pain001Payment[] = [];
  for (const { expense: e } of rows) {
    if (e.voucherNumber === null) throw new ExpenseStateError(`${e.reference} isn’t booked in Fortnox yet.`);
    const creditor = await readBankDetails(db, e.userId);
    if (!creditor) throw new ExpenseStateError(`${e.reference}: the member hasn’t added a bank account.`);
    payments.push({ endToEndId: e.reference, amountOre: e.totalOre, creditor, remittance: `Utlägg ${e.reference} Alversjö` });
  }
  payments.sort((a, b) => a.endToEndId.localeCompare(b.endToEndId));

  const reference = newReference(`UB-${input.executionDate.replace(/-/g, '')}`, 4);
  const xml = buildPain001({
    messageId: reference,
    createdAt: now,
    executionDate: input.executionDate,
    debtor: {
      name: settings.debtorName, orgNumber: settings.debtorOrgNumber, iban: settings.debtorIban,
      bic: settings.debtorBic, bankCustomerId: settings.bankCustomerId,
    },
    payments,
  });

  return db.transaction(async (tx) => {
    const [batch] = await tx.insert(schema.paymentBatch).values({
      id: randomUUID(),
      reference,
      executionDate: input.executionDate,
      totalOre: payments.reduce((s, p) => s + p.amountOre, 0),
      count: payments.length,
      fileEncrypted: encryptText(xml),
      createdByUserId: input.actorUserId,
    }).returning();
    const claimed = await tx.update(schema.expense)
      .set({ paymentBatchId: batch.id, updatedAt: new Date() })
      .where(and(inArray(schema.expense.id, ids), eq(schema.expense.status, 'approved'), isNull(schema.expense.paymentBatchId)))
      .returning({ id: schema.expense.id });
    if (claimed.length !== ids.length) throw new ExpenseStateError('Another payment file took some of these outlays. Reload and try again.');
    await logDecision(tx as unknown as Db, {
      entity: 'payment_batch', entityId: batch.id, actorUserId: input.actorUserId, action: 'create',
      diff: { reference, executionDate: input.executionDate, expenses: rows.map((r) => r.expense.reference), totalOre: batch.totalOre },
    });
    return batch;
  });
}

export async function listPaymentBatches(db: Db): Promise<PaymentBatch[]> {
  return db.select().from(schema.paymentBatch).orderBy(desc(schema.paymentBatch.createdAt));
}

export async function getPaymentBatch(db: Db, id: string) {
  const [batch] = await db.select().from(schema.paymentBatch).where(eq(schema.paymentBatch.id, id));
  if (!batch) return null;
  const expenses = await db.select({ expense: schema.expense, memberName: schema.user.name, memberEmail: schema.user.email })
    .from(schema.expense).innerJoin(schema.user, eq(schema.user.id, schema.expense.userId))
    .where(eq(schema.expense.paymentBatchId, id)).orderBy(asc(schema.expense.reference));
  return { batch, expenses: expenses.map((r) => ({ ...r.expense, memberName: r.memberName, memberEmail: r.memberEmail })) };
}

/** The XML, decrypted for download. Every download is logged: the file holds account numbers. */
export async function downloadPaymentFile(db: Db, input: { batchId: string; actorUserId: string }): Promise<{ fileName: string; xml: string }> {
  const [batch] = await db.select().from(schema.paymentBatch).where(eq(schema.paymentBatch.id, input.batchId));
  if (!batch) throw new ExpenseStateError('Payment file not found.');
  await logDecision(db, { entity: 'payment_batch', entityId: batch.id, actorUserId: input.actorUserId, action: 'download', diff: { reference: batch.reference } });
  return { fileName: `${batch.reference}.xml`, xml: decryptText(batch.fileEncrypted) };
}

export async function cancelPaymentBatch(db: Db, input: { batchId: string; actorUserId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const updated = await tx.update(schema.paymentBatch)
      .set({ status: 'cancelled', decidedByUserId: input.actorUserId })
      .where(and(eq(schema.paymentBatch.id, input.batchId), eq(schema.paymentBatch.status, 'exported')))
      .returning();
    if (updated.length === 0) throw new ExpenseStateError('Only a payment file that hasn’t been marked paid can be cancelled.');
    await tx.update(schema.expense).set({ paymentBatchId: null, updatedAt: new Date() }).where(eq(schema.expense.paymentBatchId, input.batchId));
    await logDecision(tx as unknown as Db, { entity: 'payment_batch', entityId: input.batchId, actorUserId: input.actorUserId, action: 'cancel', diff: {} });
  });
}

/** The bank has paid: outlays become paid and members are told. Booking the UB voucher is bookPayout. */
export async function markPaymentBatchPaid(
  db: Db,
  input: { batchId: string; actorUserId: string; paidDate: string },
  notify: Notify,
): Promise<void> {
  if (!isIsoDate(input.paidDate)) throw new ExpenseInputError('Enter the date the bank paid.');
  const paidOutlays = await db.transaction(async (tx) => {
    const updated = await tx.update(schema.paymentBatch)
      .set({ status: 'paid', paidAt: input.paidDate, decidedByUserId: input.actorUserId })
      .where(and(eq(schema.paymentBatch.id, input.batchId), eq(schema.paymentBatch.status, 'exported')))
      .returning();
    if (updated.length === 0) throw new ExpenseStateError('This payment file is not waiting to be paid.');
    const outlays = await tx.update(schema.expense)
      .set({ status: 'paid', paidAt: new Date(`${input.paidDate}T12:00:00Z`), updatedAt: new Date() })
      .where(eq(schema.expense.paymentBatchId, input.batchId))
      .returning();
    await logDecision(tx as unknown as Db, {
      entity: 'payment_batch', entityId: input.batchId, actorUserId: input.actorUserId, action: 'paid', diff: { paidDate: input.paidDate },
    });
    return outlays;
  });
  for (const e of paidOutlays) {
    const [u] = await db.select({ email: schema.user.email }).from(schema.user).where(eq(schema.user.id, e.userId));
    if (u) {
      await notify(u.email, `Outlay ${e.reference} paid`,
        `Alversjö has paid ${(e.totalOre / 100).toFixed(2).replace('.', ',')} kr for “${e.description}” (${e.reference}). It should reach your account within a few banking days.`);
    }
  }
}
