import { randomBytes, randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { Expense, ExpenseStatus } from '@/db/schema';
import { logDecision } from '@/lib/decision-log';
import type { Notify } from './bank-account-service';

export const MAX_RECEIPTS = 5;
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_RECEIPT_BYTES = 25 * 1024 * 1024; // per submission, before photos are shrunk
export const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export class ExpenseInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpenseInputError';
  }
}

export class ExpenseNotFoundError extends Error {
  constructor(id: string) {
    super(`Outlay ${id} not found`);
    this.name = 'ExpenseNotFoundError';
  }
}

export class ExpenseStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpenseStateError';
  }
}

export type ReceiptUpload = { fileName: string; contentType: string; data: Buffer };

export type NewExpenseInput = {
  userId: string;
  projectId: string | null;
  description: string;
  merchant: string;
  purchaseDate: string;
  totalOre: number;
  vatOre: number;
  note: string;
  receipts: ReceiptUpload[];
  ocrSuggestion?: unknown;
};

// No 0/O/1/I: references are read aloud and typed into bank apps.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newReference(prefix: string, length = 6): string {
  const bytes = randomBytes(length);
  return `${prefix}-${Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')}`;
}

function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Parses "123,45" / "123.45" / "1 234,50" kronor into öre; null if not a number. */
export function parseKronor(raw: string): number | null {
  const cleaned = raw.replace(/[\s ]/g, '').replace(/kr$/i, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

export function validateExpenseFields(input: Pick<NewExpenseInput, 'description' | 'purchaseDate' | 'totalOre' | 'vatOre'>, today = new Date()): void {
  if (!input.description.trim()) throw new ExpenseInputError('Say what you bought.');
  if (input.description.length > 200) throw new ExpenseInputError('Keep the description under 200 characters.');
  if (!isIsoDate(input.purchaseDate)) throw new ExpenseInputError('Enter the purchase date.');
  const tomorrow = new Date(today.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  if (input.purchaseDate > tomorrow) throw new ExpenseInputError('The purchase date is in the future.');
  if (!Number.isInteger(input.totalOre) || input.totalOre <= 0) throw new ExpenseInputError('Enter the amount you paid.');
  if (input.totalOre > 100_000_00) throw new ExpenseInputError('Outlays above 100 000 kr need to go through the treasurer directly.');
  if (!Number.isInteger(input.vatOre) || input.vatOre < 0 || input.vatOre >= input.totalOre) {
    throw new ExpenseInputError('VAT must be less than the total (0 if there is none).');
  }
}

export function validateReceipts(receipts: ReceiptUpload[]): void {
  if (receipts.length === 0) throw new ExpenseInputError('Add a photo or PDF of the receipt.');
  if (receipts.length > MAX_RECEIPTS) throw new ExpenseInputError(`At most ${MAX_RECEIPTS} files per outlay.`);
  for (const r of receipts) {
    if (!RECEIPT_TYPES.includes(r.contentType)) throw new ExpenseInputError(`${r.fileName}: use a JPEG, PNG, WebP or PDF file.`);
    if (r.data.length > MAX_RECEIPT_BYTES) throw new ExpenseInputError(`${r.fileName} is larger than 10 MB.`);
  }
}

export async function createExpense(db: Db, input: NewExpenseInput): Promise<Expense> {
  validateExpenseFields(input);
  validateReceipts(input.receipts);
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(schema.expense).values({
      id: randomUUID(),
      reference: newReference('U'),
      userId: input.userId,
      projectId: input.projectId,
      description: input.description.trim(),
      merchant: input.merchant.trim(),
      purchaseDate: input.purchaseDate,
      totalOre: input.totalOre,
      vatOre: input.vatOre,
      note: input.note.trim(),
      ocrSuggestion: input.ocrSuggestion ?? null,
    }).returning();
    for (const r of input.receipts) {
      await tx.insert(schema.expenseReceipt).values({
        id: randomUUID(), expenseId: row.id, fileName: r.fileName.slice(0, 200), contentType: r.contentType, sizeBytes: r.data.length, data: r.data,
      });
    }
    return row;
  });
}

export type ExpenseListItem = Expense & { memberName: string; memberEmail: string; projectTitle: string | null };

function listQuery(db: Db) {
  return db.select({
    expense: schema.expense,
    memberName: schema.user.name,
    memberEmail: schema.user.email,
    projectTitle: schema.project.title,
  }).from(schema.expense)
    .innerJoin(schema.user, eq(schema.user.id, schema.expense.userId))
    .leftJoin(schema.project, eq(schema.project.id, schema.expense.projectId));
}

function flatten(rows: { expense: Expense; memberName: string; memberEmail: string; projectTitle: string | null }[]): ExpenseListItem[] {
  return rows.map((r) => ({ ...r.expense, memberName: r.memberName, memberEmail: r.memberEmail, projectTitle: r.projectTitle }));
}

export async function listExpensesForUser(db: Db, userId: string): Promise<ExpenseListItem[]> {
  return flatten(await listQuery(db).where(eq(schema.expense.userId, userId)).orderBy(desc(schema.expense.createdAt)));
}

export async function listExpensesByStatus(db: Db, statuses: ExpenseStatus[]): Promise<ExpenseListItem[]> {
  return flatten(await listQuery(db).where(inArray(schema.expense.status, statuses)).orderBy(asc(schema.expense.createdAt)));
}

export type ReceiptMeta = { id: string; fileName: string; contentType: string; sizeBytes: number; fortnoxFileId: string | null; connectedAt: Date | null };

export async function getExpense(db: Db, id: string): Promise<(ExpenseListItem & { receipts: ReceiptMeta[] }) | null> {
  const [row] = flatten(await listQuery(db).where(eq(schema.expense.id, id)));
  if (!row) return null;
  const receipts = await db.select({
    id: schema.expenseReceipt.id, fileName: schema.expenseReceipt.fileName, contentType: schema.expenseReceipt.contentType,
    sizeBytes: schema.expenseReceipt.sizeBytes, fortnoxFileId: schema.expenseReceipt.fortnoxFileId, connectedAt: schema.expenseReceipt.connectedAt,
  }).from(schema.expenseReceipt).where(eq(schema.expenseReceipt.expenseId, id)).orderBy(asc(schema.expenseReceipt.createdAt));
  return { ...row, receipts };
}

export async function getReceipt(db: Db, receiptId: string) {
  const [row] = await db.select({ receipt: schema.expenseReceipt, ownerId: schema.expense.userId })
    .from(schema.expenseReceipt)
    .innerJoin(schema.expense, eq(schema.expense.id, schema.expenseReceipt.expenseId))
    .where(eq(schema.expenseReceipt.id, receiptId));
  return row ?? null;
}

async function requireExpense(db: Db, id: string): Promise<Expense> {
  const [row] = await db.select().from(schema.expense).where(eq(schema.expense.id, id));
  if (!row) throw new ExpenseNotFoundError(id);
  return row;
}

async function emailOf(db: Db, userId: string): Promise<string | null> {
  const [u] = await db.select({ email: schema.user.email }).from(schema.user).where(eq(schema.user.id, userId));
  return u?.email ?? null;
}

/** The submitter can take an outlay back while nobody has decided on it yet. */
export async function withdrawExpense(db: Db, input: { id: string; userId: string }): Promise<void> {
  const row = await requireExpense(db, input.id);
  if (row.userId !== input.userId) throw new ExpenseStateError('Only the person who submitted it can withdraw an outlay.');
  if (row.status !== 'submitted') throw new ExpenseStateError('This outlay has already been handled and can’t be withdrawn.');
  const deleted = await db.delete(schema.expense).where(and(eq(schema.expense.id, input.id), eq(schema.expense.status, 'submitted'))).returning({ id: schema.expense.id });
  if (deleted.length === 0) throw new ExpenseStateError('This outlay has already been handled and can’t be withdrawn.');
}

export async function rejectExpense(db: Db, input: { id: string; actorUserId: string; reason: string }, notify: Notify): Promise<void> {
  const reason = input.reason.trim();
  if (!reason) throw new ExpenseInputError('Say why, so the member can fix it.');
  const updated = await db.update(schema.expense)
    .set({ status: 'rejected', rejectionReason: reason, decidedByUserId: input.actorUserId, decidedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.expense.id, input.id), eq(schema.expense.status, 'submitted')))
    .returning();
  if (updated.length === 0) throw new ExpenseStateError('Only a submitted outlay can be rejected.');
  const row = updated[0];
  await logDecision(db, { entity: 'expense', entityId: row.id, actorUserId: input.actorUserId, action: 'reject', diff: { reason } });
  const to = await emailOf(db, row.userId);
  if (to) await notify(to, `Outlay ${row.reference} was not approved`, `Your outlay “${row.description}” (${row.reference}) was not approved:\n\n${reason}`);
}

export type ApproveInput = {
  id: string;
  actorUserId: string;
  costAccount: number;
  costCentreCode: string | null;
  fxProjectCode: string | null;
  bookVat: boolean;
};

/** Approves an outlay and fixes how it will be booked. Booking in Fortnox is a separate step (booking.ts). */
export async function approveExpense(db: Db, input: ApproveInput, notify: Notify): Promise<void> {
  if (!Number.isInteger(input.costAccount) || input.costAccount < 1000 || input.costAccount > 9999) {
    throw new ExpenseInputError('Choose a four-digit cost account.');
  }
  const updated = await db.update(schema.expense)
    .set({
      status: 'approved',
      costAccount: input.costAccount,
      costCentreCode: input.costCentreCode || null,
      fxProjectCode: input.fxProjectCode || null,
      bookVat: input.bookVat,
      decidedByUserId: input.actorUserId,
      decidedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(schema.expense.id, input.id), eq(schema.expense.status, 'submitted')))
    .returning();
  if (updated.length === 0) throw new ExpenseStateError('Only a submitted outlay can be approved.');
  const row = updated[0];
  await logDecision(db, {
    entity: 'expense', entityId: row.id, actorUserId: input.actorUserId, action: 'approve',
    diff: { costAccount: input.costAccount, costCentreCode: input.costCentreCode, fxProjectCode: input.fxProjectCode, bookVat: input.bookVat },
  });
  const to = await emailOf(db, row.userId);
  if (to) await notify(to, `Outlay ${row.reference} approved`, `Your outlay “${row.description}” (${row.reference}) was approved and will be paid in the next payment run.`);
}

/** The cost centre of the outlay's project group, the default at approval. */
export async function defaultCostCentre(db: Db, projectId: string | null): Promise<string | null> {
  if (!projectId) return null;
  const [row] = await db.select({ code: schema.projectGroup.costCentreCode })
    .from(schema.project)
    .innerJoin(schema.projectGroup, eq(schema.projectGroup.id, schema.project.projectGroupId))
    .where(eq(schema.project.id, projectId));
  return row?.code ?? null;
}

/** Approved, booked, not yet in a payment file. */
export async function listPayable(db: Db): Promise<(ExpenseListItem & { hasBankAccount: boolean })[]> {
  const rows = flatten(await listQuery(db)
    .where(and(eq(schema.expense.status, 'approved'), isNull(schema.expense.paymentBatchId)))
    .orderBy(asc(schema.expense.createdAt)));
  const booked = rows.filter((r) => r.voucherNumber !== null);
  if (booked.length === 0) return [];
  const accounts = await db.select({ userId: schema.memberBankAccount.userId }).from(schema.memberBankAccount)
    .where(inArray(schema.memberBankAccount.userId, [...new Set(booked.map((r) => r.userId))]));
  const withAccount = new Set(accounts.map((a) => a.userId));
  return booked.map((r) => ({ ...r, hasBankAccount: withAccount.has(r.userId) }));
}
