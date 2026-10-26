'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import type { Role } from '@/db/schema';
import { requireRoleAdmin } from '@/lib/session';
import { NotAuthorizedError, setUserRole } from '@/lib/roles/service';

export async function setUserRoleAction(formData: FormData) {
  const actor = await requireRoleAdmin();
  const targetUserId = String(formData.get('userId'));
  const role = String(formData.get('role')) as Role;
  const grant = formData.get('grant') === 'true';
  try {
    await setUserRole(await getDb(), { actor, targetUserId, role, grant });
  } catch (e) {
    if (e instanceof NotAuthorizedError) redirect(`/roles?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath('/roles');
  redirect('/roles');
}
