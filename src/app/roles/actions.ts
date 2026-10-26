'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import type { Role } from '@/db/schema';
import { requireRoleAdmin } from '@/lib/session';
import { NotAuthorizedError, setUserRole, UnknownRoleError } from '@/lib/roles/service';

function knownMessage(e: unknown): string | undefined {
  if (e instanceof NotAuthorizedError || e instanceof UnknownRoleError) return e.message;
  return undefined;
}

export async function setUserRoleAction(formData: FormData) {
  const actor = await requireRoleAdmin();
  const targetUserId = String(formData.get('userId'));
  const role = String(formData.get('role')) as Role;
  const grant = formData.get('grant') === 'true';
  try {
    await setUserRole(await getDb(), { actor, targetUserId, role, grant });
  } catch (e) {
    const message = knownMessage(e);
    if (message === undefined) throw e;
    redirect(`/roles?error=${encodeURIComponent(message)}`);
  }
  revalidatePath('/roles');
  redirect('/roles');
}
