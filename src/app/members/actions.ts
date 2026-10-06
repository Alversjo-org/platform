'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb, schema } from '@/db';
import { sendRenewalEmail } from '@/lib/email';
import { InvalidPhoneError, touchLastContacted, updateMember, UserNotFoundError } from '@/lib/members/service';
import { requireMemberAdmin } from '@/lib/session';

function knownMessage(e: unknown): string | undefined {
  if (e instanceof UserNotFoundError || e instanceof InvalidPhoneError) return e.message;
  return undefined;
}

export async function updateMemberAction(formData: FormData) {
  await requireMemberAdmin();
  const id = String(formData.get('id'));
  const expiresRaw = String(formData.get('membershipExpiresAt') ?? '').trim();
  const phoneRaw = String(formData.get('phoneNumber') ?? '').trim();

  let errorRedirect: string | undefined;
  try {
    await updateMember(await getDb(), {
      id,
      name: String(formData.get('name') ?? '').trim(),
      nickname: String(formData.get('nickname') ?? '').trim() || null,
      phoneNumber: phoneRaw === '' ? null : phoneRaw,
      discordHandle: String(formData.get('discordHandle') ?? '').trim() || null,
      isActiveMember: formData.get('isActiveMember') !== null,
      membershipExpiresAt: expiresRaw === '' ? null : new Date(expiresRaw),
      contactNotes: String(formData.get('contactNotes') ?? '').trim() || null,
    });
  } catch (e) {
    const message = knownMessage(e);
    if (message === undefined) throw e;
    errorRedirect = `/members/${id}?error=${encodeURIComponent(message)}`;
  }
  if (errorRedirect) redirect(errorRedirect);
  revalidatePath('/members');
  revalidatePath(`/members/${id}`);
  redirect('/members');
}

export async function sendRenewalAskAction(formData: FormData) {
  await requireMemberAdmin();
  const id = String(formData.get('id'));
  const subject = String(formData.get('subject') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  const db = await getDb();
  const [member] = await db.select().from(schema.user).where(eq(schema.user.id, id));
  if (!member) throw new UserNotFoundError(id);
  await sendRenewalEmail({ to: member.email, subject, body });
  await touchLastContacted(db, id);
  revalidatePath(`/members/${id}`);
  revalidatePath('/members');
  redirect(`/members/${id}`);
}
