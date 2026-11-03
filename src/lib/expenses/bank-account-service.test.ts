import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import { decryptText, encryptText } from './bank-crypto';
import { deleteBankAccount, getBankAccountSummary, readBankDetails, setBankAccount } from './bank-account-service';
import { parseBankDetails } from './bank-details';

const iban = parseBankDetails({ kind: 'iban', holderName: 'Anna Svensson', iban: 'SE45 5000 0000 0583 9825 7466' });
const se = parseBankDetails({ kind: 'se', holderName: 'Anna Svensson', clearing: '6123', account: '123456789' });

describe('bank crypto', () => {
  it('round-trips and never stores the plaintext', () => {
    const stored = encryptText('SE4550000000058398257466');
    expect(stored).not.toContain('5839');
    expect(decryptText(stored)).toBe('SE4550000000058398257466');
  });

  it('fails on a tampered value', () => {
    const [v, iv, tag, data] = encryptText('secret').split(':');
    const flipped = Buffer.from(data, 'base64');
    flipped[0] ^= 1;
    expect(() => decryptText([v, iv, tag, flipped.toString('base64')].join(':'))).toThrow();
  });
});

describe('bank account service', () => {
  let db: Db;
  const notify = vi.fn(async () => {});
  beforeEach(async () => {
    db = await createDb('pglite://memory');
    notify.mockClear();
    await db.insert(schema.user).values({ id: 'u1', email: 'anna@example.org' });
  });

  it('stores the account encrypted, shows only the last four, and reads it back in full', async () => {
    await setBankAccount(db, { userId: 'u1', actorUserId: 'u1', details: iban }, notify);
    const [row] = await db.select().from(schema.memberBankAccount).where(eq(schema.memberBankAccount.userId, 'u1'));
    expect(row.encrypted).not.toContain('58398257466');
    expect(await getBankAccountSummary(db, 'u1')).toMatchObject({ kind: 'iban', holderName: 'Anna Svensson', last4: '7466' });
    expect(await readBankDetails(db, 'u1')).toEqual(iban);
  });

  it('emails the member and logs the change without the account number', async () => {
    await setBankAccount(db, { userId: 'u1', actorUserId: 'u1', details: iban }, notify);
    await setBankAccount(db, { userId: 'u1', actorUserId: 'u1', details: se }, notify);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls[1]).toEqual(['anna@example.org', 'Your payout bank account was changed', expect.stringContaining('ends in 6789')]);
    const log = await db.select().from(schema.decisionLog).where(eq(schema.decisionLog.entity, 'member_bank_account'));
    expect(log.map((l) => l.action)).toEqual(['create', 'replace']);
    expect(log.map((l) => l.diff).join()).not.toContain('123456789');
    expect(await readBankDetails(db, 'u1')).toEqual(se);
  });

  it('deletes and notifies', async () => {
    await setBankAccount(db, { userId: 'u1', actorUserId: 'u1', details: iban }, notify);
    await deleteBankAccount(db, { userId: 'u1', actorUserId: 'u1' }, notify);
    expect(await getBankAccountSummary(db, 'u1')).toBeNull();
    expect(notify).toHaveBeenLastCalledWith('anna@example.org', 'Your payout bank account was removed', expect.any(String));
  });
});
