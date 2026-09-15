'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { BoxProfile } from '@/db/schema';
import { boxDeps } from '@/lib/boxes/deps';
import { createBox, destroyBox, revokeBox, shareBox, startBox, stopBox } from '@/lib/boxes/service';
import { requireAdmin } from '@/lib/session';

export async function createBoxAction(formData: FormData) {
  const admin = await requireAdmin();
  const name = String(formData.get('name') ?? '').trim();
  const profile = String(formData.get('profile')) as BoxProfile;
  if (!name || !['admin', 'contributor'].includes(profile)) throw new Error('Name and profile are required');
  const box = await createBox(await boxDeps(), { name, profile, ownerUserId: admin.id });
  redirect(`/boxes/${box.id}`);
}

export async function startBoxAction(formData: FormData) {
  await requireAdmin();
  await startBox(await boxDeps(), String(formData.get('id')));
  revalidatePath('/boxes');
}

export async function stopBoxAction(formData: FormData) {
  await requireAdmin();
  await stopBox(await boxDeps(), String(formData.get('id')));
  revalidatePath('/boxes');
}

export async function destroyBoxAction(formData: FormData) {
  await requireAdmin();
  await destroyBox(await boxDeps(), String(formData.get('id')));
  redirect('/boxes');
}

export async function shareBoxAction(formData: FormData) {
  const admin = await requireAdmin();
  const boxId = String(formData.get('id'));
  await shareBox(await boxDeps(), { boxId, email: String(formData.get('email')), grantedByUserId: admin.id });
  revalidatePath(`/boxes/${boxId}`);
}

export async function revokeBoxAction(formData: FormData) {
  await requireAdmin();
  const boxId = String(formData.get('id'));
  await revokeBox(await boxDeps(), { boxId, userId: String(formData.get('userId')) });
  revalidatePath(`/boxes/${boxId}`);
}
