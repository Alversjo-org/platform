import { eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { BankAccountKind } from '@/db/schema';
import { logDecision } from '@/lib/decision-log';
import { decryptText, encryptText } from './bank-crypto';
import { last4, type BankDetails } from './bank-details';

/** What may be shown on screen: never the full account number. */
export type BankAccountSummary = { kind: BankAccountKind; holderName: string; last4: string; updatedAt: Date };

export type Notify = (to: string, subject: string, text: string) => Promise<void>;

export async function getBankAccountSummary(db: Db, userId: string): Promise<BankAccountSummary | null> {
  const [row] = await db.select({
    kind: schema.memberBankAccount.kind,
    holderName: schema.memberBankAccount.holderName,
    last4: schema.memberBankAccount.last4,
    updatedAt: schema.memberBankAccount.updatedAt,
  }).from(schema.memberBankAccount).where(eq(schema.memberBankAccount.userId, userId));
  return row ?? null;
}

/**
 * Full account details, decrypted. Only the payment-file export calls this; nothing renders it.
 */
export async function readBankDetails(db: Db, userId: string): Promise<BankDetails | null> {
  const [row] = await db.select().from(schema.memberBankAccount).where(eq(schema.memberBankAccount.userId, userId));
  if (!row) return null;
  const secret = JSON.parse(decryptText(row.encrypted)) as Record<string, string>;
  return row.kind === 'iban'
    ? { kind: 'iban', holderName: row.holderName, iban: secret.iban, bic: secret.bic ?? '' }
    : { kind: 'se', holderName: row.holderName, clearing: secret.clearing, account: secret.account };
}

async function emailOf(db: Db, userId: string): Promise<string | null> {
  const [u] = await db.select({ email: schema.user.email }).from(schema.user).where(eq(schema.user.id, userId));
  return u?.email ?? null;
}

const CHANGE_WARNING =
  'If this wasn’t you, tell the treasurer straight away and sign in to check your bank details: ' +
  'a changed payout account is the usual way outlay payments are stolen.';

/**
 * Saves (or replaces) a member's payout account, logs the change without the number, and
 * emails the member, so a hijacked login can't quietly redirect their reimbursements.
 */
export async function setBankAccount(
  db: Db,
  input: { userId: string; actorUserId: string; details: BankDetails },
  notify: Notify,
): Promise<void> {
  const { details } = input;
  const secret = details.kind === 'iban' ? { iban: details.iban, bic: details.bic } : { clearing: details.clearing, account: details.account };
  const before = await getBankAccountSummary(db, input.userId);
  const values = {
    kind: details.kind,
    holderName: details.holderName,
    encrypted: encryptText(JSON.stringify(secret)),
    last4: last4(details),
    updatedAt: new Date(),
    updatedByUserId: input.actorUserId,
  };
  await db.insert(schema.memberBankAccount).values({ userId: input.userId, ...values })
    .onConflictDoUpdate({ target: schema.memberBankAccount.userId, set: values });
  await logDecision(db, {
    entity: 'member_bank_account',
    entityId: input.userId,
    actorUserId: input.actorUserId,
    action: before ? 'replace' : 'create',
    diff: { from: before ? { kind: before.kind, last4: before.last4 } : null, to: { kind: values.kind, last4: values.last4 } },
  });
  const to = await emailOf(db, input.userId);
  if (to) {
    await notify(to, 'Your payout bank account was changed',
      `The bank account Alversjö pays your outlays to was ${before ? 'changed' : 'added'}: it now ends in ${values.last4}.\n\n${CHANGE_WARNING}`);
  }
}

export async function deleteBankAccount(db: Db, input: { userId: string; actorUserId: string }, notify: Notify): Promise<void> {
  const before = await getBankAccountSummary(db, input.userId);
  if (!before) return;
  await db.delete(schema.memberBankAccount).where(eq(schema.memberBankAccount.userId, input.userId));
  await logDecision(db, {
    entity: 'member_bank_account',
    entityId: input.userId,
    actorUserId: input.actorUserId,
    action: 'delete',
    diff: { from: { kind: before.kind, last4: before.last4 }, to: null },
  });
  const to = await emailOf(db, input.userId);
  if (to) await notify(to, 'Your payout bank account was removed', `Your payout account ending in ${before.last4} was removed.\n\n${CHANGE_WARNING}`);
}
