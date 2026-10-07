'use server';

import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getDb, schema } from '@/db';
import { resizeAvatar } from '@/lib/members/avatar';
import { clearAvatar, InvalidPhoneError, UserNotFoundError, updateOwnProfile } from '@/lib/members/service';
import { requireUser } from '@/lib/session';
import { MAX_AVATAR_BYTES } from './constants';

export async function updateProfileAction(formData: FormData) {
  const user = await requireUser();
  const phoneRaw = String(formData.get('phoneNumber') ?? '').trim();

  const avatarFile = formData.get('avatar');
  let image: string | undefined;
  if (avatarFile instanceof File && avatarFile.size > 0) {
    if (avatarFile.size > MAX_AVATAR_BYTES) {
      redirect(`/profile?error=${encodeURIComponent('Image is too large (max 5MB)')}`);
    }
    try {
      image = await resizeAvatar(Buffer.from(await avatarFile.arrayBuffer()));
    } catch {
      redirect(`/profile?error=${encodeURIComponent('Could not process that image')}`);
    }
  }

  try {
    await updateOwnProfile(await getDb(), {
      id: user.id,
      name: String(formData.get('name') ?? '').trim(),
      nickname: String(formData.get('nickname') ?? '').trim() || null,
      phoneNumber: phoneRaw === '' ? null : phoneRaw,
      discordHandle: String(formData.get('discordHandle') ?? '').trim() || null,
      ...(image !== undefined ? { image } : {}),
    });
  } catch (e) {
    if (e instanceof InvalidPhoneError) redirect(`/profile?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect('/profile');
}

export async function removeAvatarAction() {
  const user = await requireUser();
  const db = await getDb();
  const [member] = await db.select().from(schema.user).where(eq(schema.user.id, user.id));
  if (!member) throw new UserNotFoundError(user.id);
  await clearAvatar(db, user.id);
  redirect('/profile');
}
