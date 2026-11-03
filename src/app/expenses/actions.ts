'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb, type Db } from '@/db';
import { sendNoticeEmail } from '@/lib/email';
import { bookExpense, bookPayout } from '@/lib/expenses/booking';
import { readReceipt, type ReceiptSuggestion } from '@/lib/expenses/ocr';
import { cancelPaymentBatch, createPaymentBatch, markPaymentBatchPaid } from '@/lib/expenses/payments';
import { prepareReceipt } from '@/lib/expenses/receipt-files';
import {
  approveExpense, createExpense, ExpenseInputError, ExpenseNotFoundError, ExpenseStateError, MAX_TOTAL_RECEIPT_BYTES,
  parseKronor, rejectExpense, validateReceipts, withdrawExpense,
} from '@/lib/expenses/service';
import { updateExpenseSettings } from '@/lib/expenses/settings';
import { createFortnoxClient, type FortnoxClient } from '@/lib/fortnox/client';
import { getValidAccessToken, NeedsReauthError } from '@/lib/fortnox/connection-service';
import { BankDataKeyMissingError } from '@/lib/expenses/bank-crypto';
import { InvalidPaymentFileError } from '@/lib/expenses/pain001';
import { requireTreasurer, requireUser } from '@/lib/session';

const notify = (to: string, subject: string, text: string) => sendNoticeEmail({ to, subject, text });

function userError(e: unknown): string | null {
  if (e instanceof ExpenseInputError || e instanceof ExpenseStateError || e instanceof ExpenseNotFoundError
    || e instanceof InvalidPaymentFileError || e instanceof BankDataKeyMissingError) return e.message;
  return null;
}

function back(path: string, error: string): never {
  redirect(`${path}${path.includes('?') ? '&' : '?'}error=${encodeURIComponent(error)}`);
}

/** Runs a Fortnox write with a fresh token; a missing connection becomes a readable error. */
async function withFortnox<T>(db: Db, fn: (client: FortnoxClient, token: string) => Promise<T>): Promise<T | { ok: false; error: string }> {
  const client = createFortnoxClient();
  let token: string;
  try {
    token = await getValidAccessToken(db, client);
  } catch (e) {
    if (e instanceof NeedsReauthError) return { ok: false, error: 'Fortnox is not connected — reconnect it on the Fortnox page, then book again.' };
    throw e;
  }
  return fn(client, token);
}

function files(formData: FormData, name: string): File[] {
  return formData.getAll(name).filter((f): f is File => f instanceof File && f.size > 0);
}

// ---- members ---------------------------------------------------------------------------------

/** Reads the first receipt and suggests the form fields. Null when the reader is off or unsure. */
export async function readReceiptAction(formData: FormData): Promise<ReceiptSuggestion | null> {
  await requireUser();
  const [file] = files(formData, 'receipt');
  if (!file) return null;
  try {
    const receipt = await prepareReceipt(file);
    return await readReceipt(receipt);
  } catch {
    return null;
  }
}

export async function createExpenseAction(formData: FormData): Promise<{ error: string }> {
  const user = await requireUser();
  const f = (k: string) => String(formData.get(k) ?? '').trim();
  const uploads = files(formData, 'receipts');
  let id: string;
  try {
    if (uploads.reduce((s, u) => s + u.size, 0) > MAX_TOTAL_RECEIPT_BYTES) throw new ExpenseInputError('The files are too large together (max 25 MB). Send fewer or smaller photos.');
    const receipts = await Promise.all(uploads.map(prepareReceipt));
    validateReceipts(receipts);
    const totalOre = parseKronor(f('total'));
    const vatOre = f('vat') === '' ? 0 : parseKronor(f('vat'));
    if (totalOre === null) throw new ExpenseInputError('Enter the amount you paid, e.g. 249,90.');
    if (vatOre === null) throw new ExpenseInputError('Enter the VAT as an amount, e.g. 49,98 (or leave it empty).');
    let ocrSuggestion: unknown = null;
    try { ocrSuggestion = f('ocr') ? JSON.parse(f('ocr')) : null; } catch { ocrSuggestion = null; }
    const row = await createExpense(await getDb(), {
      userId: user.id,
      projectId: f('projectId') || null,
      description: f('description'),
      merchant: f('merchant'),
      purchaseDate: f('purchaseDate'),
      totalOre,
      vatOre,
      note: f('note'),
      receipts,
      ocrSuggestion,
    });
    id = row.id;
  } catch (e) {
    const message = userError(e);
    if (message) return { error: message };
    throw e;
  }
  revalidatePath('/expenses');
  redirect(`/expenses/${id}?submitted=1`);
}

export async function withdrawExpenseAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get('id'));
  try {
    await withdrawExpense(await getDb(), { id, userId: user.id });
  } catch (e) {
    const message = userError(e);
    if (message) back(`/expenses/${id}`, message);
    throw e;
  }
  redirect('/expenses');
}

// ---- treasurer -------------------------------------------------------------------------------

export async function approveExpenseAction(formData: FormData): Promise<void> {
  const treasurer = await requireTreasurer();
  const id = String(formData.get('id'));
  const db = await getDb();
  try {
    await approveExpense(db, {
      id,
      actorUserId: treasurer.id,
      costAccount: Number(formData.get('costAccount')),
      costCentreCode: String(formData.get('costCentreCode') ?? '').trim() || null,
      fxProjectCode: String(formData.get('fxProjectCode') ?? '').trim() || null,
      bookVat: formData.get('bookVat') === 'on',
    }, notify);
  } catch (e) {
    const message = userError(e);
    if (message) back(`/expenses/${id}`, message);
    throw e;
  }
  const result = await withFortnox(db, (client, token) => bookExpense(db, client, token, id));
  revalidatePath('/expenses/review');
  if (!result.ok) back(`/expenses/${id}`, `Approved, but booking in Fortnox failed: ${result.error}`);
  redirect(`/expenses/${id}`);
}

export async function rejectExpenseAction(formData: FormData): Promise<void> {
  const treasurer = await requireTreasurer();
  const id = String(formData.get('id'));
  try {
    await rejectExpense(await getDb(), { id, actorUserId: treasurer.id, reason: String(formData.get('reason') ?? '') }, notify);
  } catch (e) {
    const message = userError(e);
    if (message) back(`/expenses/${id}`, message);
    throw e;
  }
  revalidatePath('/expenses/review');
  redirect(`/expenses/${id}`);
}

export async function bookExpenseAction(formData: FormData): Promise<void> {
  await requireTreasurer();
  const id = String(formData.get('id'));
  const db = await getDb();
  const result = await withFortnox(db, (client, token) => bookExpense(db, client, token, id));
  if (!result.ok) back(`/expenses/${id}`, `Booking in Fortnox failed: ${result.error}`);
  redirect(`/expenses/${id}`);
}

export async function createPaymentBatchAction(formData: FormData): Promise<void> {
  const treasurer = await requireTreasurer();
  let batchId: string;
  try {
    const batch = await createPaymentBatch(await getDb(), {
      actorUserId: treasurer.id,
      expenseIds: formData.getAll('expenseId').map(String),
      executionDate: String(formData.get('executionDate') ?? ''),
    });
    batchId = batch.id;
  } catch (e) {
    const message = userError(e);
    if (message) back('/expenses/payments', message);
    throw e;
  }
  redirect(`/expenses/payments?created=${batchId}`);
}

export async function markBatchPaidAction(formData: FormData): Promise<void> {
  const treasurer = await requireTreasurer();
  const batchId = String(formData.get('batchId'));
  const db = await getDb();
  try {
    await markPaymentBatchPaid(db, { batchId, actorUserId: treasurer.id, paidDate: String(formData.get('paidDate') ?? '') }, notify);
  } catch (e) {
    const message = userError(e);
    if (message) back('/expenses/payments', message);
    throw e;
  }
  const result = await withFortnox(db, (client, token) => bookPayout(db, client, token, batchId));
  if (!result.ok) back('/expenses/payments', `Marked as paid, but booking the payout in Fortnox failed: ${result.error}`);
  redirect('/expenses/payments');
}

export async function bookPayoutAction(formData: FormData): Promise<void> {
  await requireTreasurer();
  const batchId = String(formData.get('batchId'));
  const db = await getDb();
  const result = await withFortnox(db, (client, token) => bookPayout(db, client, token, batchId));
  if (!result.ok) back('/expenses/payments', `Booking the payout in Fortnox failed: ${result.error}`);
  redirect('/expenses/payments');
}

export async function cancelBatchAction(formData: FormData): Promise<void> {
  const treasurer = await requireTreasurer();
  try {
    await cancelPaymentBatch(await getDb(), { batchId: String(formData.get('batchId')), actorUserId: treasurer.id });
  } catch (e) {
    const message = userError(e);
    if (message) back('/expenses/payments', message);
    throw e;
  }
  redirect('/expenses/payments');
}

export async function saveExpenseSettingsAction(formData: FormData): Promise<void> {
  const treasurer = await requireTreasurer();
  const f = (k: string) => String(formData.get(k) ?? '');
  try {
    await updateExpenseSettings(await getDb(), {
      debtorName: f('debtorName'), debtorOrgNumber: f('debtorOrgNumber'), debtorIban: f('debtorIban'), debtorBic: f('debtorBic'),
      bankCustomerId: f('bankCustomerId'),
      bankLedgerAccount: Number(f('bankLedgerAccount')), liabilityAccount: Number(f('liabilityAccount')),
      vatAccount: Number(f('vatAccount')), defaultCostAccount: Number(f('defaultCostAccount')),
      outlaySeries: f('outlaySeries'), payoutSeries: f('payoutSeries'),
    }, treasurer.id);
  } catch (e) {
    const message = userError(e);
    if (message) back('/expenses/settings', message);
    throw e;
  }
  redirect('/expenses/settings?saved=1');
}
