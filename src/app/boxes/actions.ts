'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { BoxProfile } from '@/db/schema';
import { boxDeps } from '@/lib/boxes/deps';
import {
  BoxNotFoundError,
  createBox,
  destroyBox,
  ProtectedBoxError,
  revokeBox,
  shareBox,
  startBox,
  stopBox,
  UserNotFoundError,
} from '@/lib/boxes/service';
import { requireAdmin } from '@/lib/session';

/** Message for errors we expect and want to surface as an alert, rather than crashing to Next's error page. */
function knownMessage(e: unknown): string | undefined {
  if (e instanceof UserNotFoundError || e instanceof ProtectedBoxError || e instanceof BoxNotFoundError) return e.message;
  return undefined;
}

export async function createBoxAction(formData: FormData) {
  const admin = await requireAdmin();
  const name = String(formData.get('name') ?? '').trim();
  const profile = String(formData.get('profile')) as BoxProfile;
  if (!name || !['admin', 'contributor'].includes(profile)) {
    redirect(`/boxes/new?error=${encodeURIComponent('Name and profile are required')}`);
  }

  let redirectTo: string;
  try {
    const box = await createBox(await boxDeps(), { name, profile, ownerUserId: admin.id });
    redirectTo = `/boxes/${box.id}`;
  } catch (e) {
    const message = knownMessage(e);
    if (message === undefined) throw e;
    redirectTo = `/boxes/new?error=${encodeURIComponent(message)}`;
  }
  redirect(redirectTo);
}

export async function startBoxAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get('id'));
  let errorRedirect: string | undefined;
  try {
    await startBox(await boxDeps(), id);
  } catch (e) {
    const message = knownMessage(e);
    if (message === undefined) throw e;
    errorRedirect = `/boxes/${id}?error=${encodeURIComponent(message)}`;
  }
  if (errorRedirect) redirect(errorRedirect);
  revalidatePath('/boxes');
  revalidatePath(`/boxes/${id}`);
}

export async function stopBoxAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get('id'));
  let errorRedirect: string | undefined;
  try {
    await stopBox(await boxDeps(), id);
  } catch (e) {
    const message = knownMessage(e);
    if (message === undefined) throw e;
    errorRedirect = `/boxes/${id}?error=${encodeURIComponent(message)}`;
  }
  if (errorRedirect) redirect(errorRedirect);
  revalidatePath('/boxes');
  revalidatePath(`/boxes/${id}`);
}

export async function destroyBoxAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get('id'));
  let redirectTo: string;
  try {
    await destroyBox(await boxDeps(), id);
    redirectTo = '/boxes';
  } catch (e) {
    const message = knownMessage(e);
    if (message === undefined) throw e;
    redirectTo = `/boxes/${id}?error=${encodeURIComponent(message)}`;
  }
  redirect(redirectTo);
}

export async function shareBoxAction(formData: FormData) {
  const admin = await requireAdmin();
  const boxId = String(formData.get('id'));
  let errorRedirect: string | undefined;
  try {
    await shareBox(await boxDeps(), { boxId, email: String(formData.get('email')), grantedByUserId: admin.id });
  } catch (e) {
    const message = knownMessage(e);
    if (message === undefined) throw e;
    errorRedirect = `/boxes/${boxId}?error=${encodeURIComponent(message)}`;
  }
  if (errorRedirect) redirect(errorRedirect);
  revalidatePath(`/boxes/${boxId}`);
}

export async function revokeBoxAction(formData: FormData) {
  await requireAdmin();
  const boxId = String(formData.get('id'));
  let errorRedirect: string | undefined;
  try {
    await revokeBox(await boxDeps(), { boxId, userId: String(formData.get('userId')) });
  } catch (e) {
    const message = knownMessage(e);
    if (message === undefined) throw e;
    errorRedirect = `/boxes/${boxId}?error=${encodeURIComponent(message)}`;
  }
  if (errorRedirect) redirect(errorRedirect);
  revalidatePath(`/boxes/${boxId}`);
}
