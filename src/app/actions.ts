'use server';

import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getDb, schema } from '@/db';
import { InvalidPhoneError, MembershipExpiredError, updateOwnProfile } from '@/lib/members/service';
import { requireUser } from '@/lib/session';
import { createCheckoutSession, type MembershipPlan } from '@/lib/stripe/checkout';
import { getStripe } from '@/lib/stripe/client';

export async function updateProfileAction(formData: FormData) {
  const user = await requireUser();
  const phoneRaw = String(formData.get('phoneNumber') ?? '').trim();
  try {
    await updateOwnProfile(await getDb(), {
      id: user.id,
      name: String(formData.get('name') ?? '').trim(),
      nickname: String(formData.get('nickname') ?? '').trim() || null,
      phoneNumber: phoneRaw === '' ? null : phoneRaw,
      discordHandle: String(formData.get('discordHandle') ?? '').trim() || null,
    });
  } catch (e) {
    if (e instanceof InvalidPhoneError || e instanceof MembershipExpiredError) {
      redirect(`/?error=${encodeURIComponent(e.message)}`);
    }
    throw e;
  }
  redirect('/');
}

export async function startCheckoutAction(formData: FormData) {
  const sessionUser = await requireUser();
  const plan = String(formData.get('plan')) as MembershipPlan;
  const db = await getDb();
  const [member] = await db.select().from(schema.user).where(eq(schema.user.id, sessionUser.id));
  const platformUrl = process.env.PLATFORM_URL ?? 'http://localhost:3000';
  const url = await createCheckoutSession(getStripe(), { plan, user: member, platformUrl });
  redirect(url);
}
