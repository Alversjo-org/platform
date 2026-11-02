'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import type { Role } from '@/db/schema';
import { requireRoleAdmin, requireUser } from '@/lib/session';
import { NotAuthorizedError, setUserRole, UnknownRoleError } from '@/lib/roles/service';
import { decideRoleRequest, requestRole } from '@/lib/roles/request-service';

function knownMessage(e: unknown): string | undefined {
  if (e instanceof NotAuthorizedError || e instanceof UnknownRoleError) return e.message;
  return undefined;
}

export async function setUserRoleAction(formData: FormData) {
  const actor = await requireRoleAdmin();
  const targetUserId = String(formData.get('userId'));
  const role = String(formData.get('role')) as Role;
  const grant = formData.get('grant') === 'true';
  const requestedReturnTo = String(formData.get('returnTo') ?? '');
  // Same-origin path only - formData is client-supplied, not a trusted redirect target.
  const returnTo = requestedReturnTo.startsWith('/') && !requestedReturnTo.startsWith('//') ? requestedReturnTo : '/roles';
  try {
    await setUserRole(await getDb(), { actor, targetUserId, role, grant });
  } catch (e) {
    const message = knownMessage(e);
    if (message === undefined) throw e;
    redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=${encodeURIComponent(message)}`);
  }
  revalidatePath('/roles');
  revalidatePath('/members');
  redirect(returnTo);
}

export async function requestRoleAction(formData: FormData): Promise<void> {
  const actor = await requireUser();
  const role = String(formData.get('role')) as Role;
  await requestRole(await getDb(), { userId: actor.id, role });
  // Implementer's call: this action is meant to be called from pages other than /roles too
  // (e.g. a wiki page's "Ask to edit" button), so it revalidates the caller's own path
  // (passed as `returnTo`) rather than always redirecting back to /roles.
  const returnTo = String(formData.get('returnTo') ?? '');
  if (returnTo.startsWith('/') && !returnTo.startsWith('//')) revalidatePath(returnTo);
  else revalidatePath('/roles');
}

export async function decideRoleRequestAction(formData: FormData): Promise<void> {
  const actor = await requireRoleAdmin();
  const requestId = String(formData.get('requestId'));
  const approve = formData.get('approve') === 'true';
  await decideRoleRequest(await getDb(), { actor, requestId, approve });
  revalidatePath('/roles');
  redirect('/roles');
}
