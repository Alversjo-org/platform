'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import { sendNoticeEmail } from '@/lib/email';
import { deleteBankAccount, setBankAccount } from '@/lib/expenses/bank-account-service';
import { BankDataKeyMissingError } from '@/lib/expenses/bank-crypto';
import { InvalidBankDetailsError, parseBankDetails } from '@/lib/expenses/bank-details';
import { requireUser } from '@/lib/session';

const notify = (to: string, subject: string, text: string) => sendNoticeEmail({ to, subject, text });

export async function saveBankAccountAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const field = (k: string) => String(formData.get(k) ?? '');
  let details;
  try {
    details = parseBankDetails({
      kind: field('kind'), holderName: field('holderName'), iban: field('iban'), bic: field('bic'),
      clearing: field('clearing'), account: field('account'),
    });
  } catch (e) {
    if (e instanceof InvalidBankDetailsError) redirect(`/profile/bank?kind=${encodeURIComponent(field('kind'))}&error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  try {
    await setBankAccount(await getDb(), { userId: user.id, actorUserId: user.id, details }, notify);
  } catch (e) {
    if (e instanceof BankDataKeyMissingError) redirect(`/profile/bank?error=${encodeURIComponent('Bank details can’t be saved yet: the server has no encryption key. Tell the treasurer.')}`);
    throw e;
  }
  redirect('/profile/bank?saved=1');
}

export async function deleteBankAccountAction(): Promise<void> {
  const user = await requireUser();
  await deleteBankAccount(await getDb(), { userId: user.id, actorUserId: user.id }, notify);
  redirect('/profile/bank');
}
