'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import { InvalidPhoneError, updateUser, UserNotFoundError } from '@/lib/users/service';
import { requireAdmin } from '@/lib/session';

function knownMessage(e: unknown): string | undefined {
  if (e instanceof UserNotFoundError || e instanceof InvalidPhoneError) return e.message;
  return undefined;
}

export async function updateUserAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get('id'));
  const name = String(formData.get('name') ?? '').trim();
  const phoneRaw = String(formData.get('phoneNumber') ?? '').trim();
  const expiresRaw = String(formData.get('membershipExpiresAt') ?? '').trim();

  let errorRedirect: string | undefined;
  try {
    await updateUser(await getDb(), {
      id,
      name,
      phoneNumber: phoneRaw === '' ? null : phoneRaw,
      isActiveMember: formData.get('isActiveMember') !== null,
      membershipExpiresAt: expiresRaw === '' ? null : new Date(expiresRaw),
    });
  } catch (e) {
    const message = knownMessage(e);
    if (message === undefined) throw e;
    errorRedirect = `/users/${id}?error=${encodeURIComponent(message)}`;
  }
  if (errorRedirect) redirect(errorRedirect);
  revalidatePath('/users');
  revalidatePath(`/users/${id}`);
  redirect('/users');
}
