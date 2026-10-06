'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import { updateRenewalMessage } from '@/lib/members/renewal-message';
import { requireMemberAdmin } from '@/lib/session';

export async function updateRenewalMessageAction(formData: FormData) {
  const admin = await requireMemberAdmin();
  await updateRenewalMessage(await getDb(), {
    subject: String(formData.get('subject') ?? '').trim(),
    body: String(formData.get('body') ?? '').trim(),
    updatedByUserId: admin.id,
  });
  revalidatePath('/members/settings');
  redirect('/members/settings');
}
