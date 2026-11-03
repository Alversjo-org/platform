import { eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { ExpenseSettings } from '@/db/schema';
import { logDecision } from '@/lib/decision-log';
import { isValidBic, isValidIban, normalizeIban } from './bank-details';
import { ExpenseInputError } from './service';

export async function getExpenseSettings(db: Db): Promise<ExpenseSettings> {
  const [row] = await db.select().from(schema.expenseSettings).where(eq(schema.expenseSettings.id, 'default'));
  if (row) return row;
  await db.insert(schema.expenseSettings).values({ id: 'default' }).onConflictDoNothing();
  const [created] = await db.select().from(schema.expenseSettings).where(eq(schema.expenseSettings.id, 'default'));
  return created;
}

export type ExpenseSettingsInput = {
  debtorName: string; debtorOrgNumber: string; debtorIban: string; debtorBic: string; bankCustomerId: string;
  bankLedgerAccount: number; liabilityAccount: number; vatAccount: number; defaultCostAccount: number;
  outlaySeries: string; payoutSeries: string;
};

function account(n: number, label: string): number {
  if (!Number.isInteger(n) || n < 1000 || n > 9999) throw new ExpenseInputError(`${label} must be a four-digit account.`);
  return n;
}

function series(s: string, label: string): string {
  const v = s.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,10}$/.test(v)) throw new ExpenseInputError(`${label}: 1–10 letters or digits.`);
  return v;
}

export async function updateExpenseSettings(db: Db, input: ExpenseSettingsInput, actorUserId: string): Promise<void> {
  const iban = normalizeIban(input.debtorIban);
  if (iban && !isValidIban(iban)) throw new ExpenseInputError('The association’s IBAN is not valid.');
  const bic = input.debtorBic.replace(/\s/g, '').toUpperCase();
  if (bic && !isValidBic(bic)) throw new ExpenseInputError('The association’s BIC is not valid.');
  const orgNumber = input.debtorOrgNumber.replace(/\D/g, '');
  if (orgNumber && orgNumber.length !== 10) throw new ExpenseInputError('An organisation number has 10 digits.');
  const values = {
    debtorName: input.debtorName.trim().slice(0, 70),
    debtorOrgNumber: orgNumber,
    debtorIban: iban,
    debtorBic: bic,
    bankCustomerId: input.bankCustomerId.trim().slice(0, 35),
    bankLedgerAccount: account(input.bankLedgerAccount, 'Bank account'),
    liabilityAccount: account(input.liabilityAccount, 'Liability account'),
    vatAccount: account(input.vatAccount, 'VAT account'),
    defaultCostAccount: account(input.defaultCostAccount, 'Default cost account'),
    outlaySeries: series(input.outlaySeries, 'Outlay series'),
    payoutSeries: series(input.payoutSeries, 'Payout series'),
    updatedAt: new Date(),
    updatedByUserId: actorUserId,
  };
  if (values.outlaySeries === values.payoutSeries) throw new ExpenseInputError('Use different voucher series for outlays and payouts.');
  await getExpenseSettings(db);
  await db.update(schema.expenseSettings).set(values).where(eq(schema.expenseSettings.id, 'default'));
  await logDecision(db, {
    entity: 'expense_settings', entityId: 'default', actorUserId, action: 'update',
    diff: Object.fromEntries(Object.entries(values).filter(([k]) => k !== 'updatedAt' && k !== 'updatedByUserId')),
  });
}
