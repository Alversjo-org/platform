'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { getDb, schema } from '@/db';
import { sendSignupPromotedEmail } from '@/lib/email';
import { cancelSignup, signUp } from '@/lib/events/signup-service';
import { assertEventPermission, NotAuthorizedError } from '@/lib/projects/authorization';
import {
  duplicateEvent, EventCreationBlockedError, getProjectBySlug, IncompleteEventError, InvalidTransitionError, transitionStatus,
} from '@/lib/projects/service';
import { requireUser } from '@/lib/session';
import type { ProjectStatus } from '@/db/schema';

export async function duplicateEventAction(formData: FormData) {
  const user = await requireUser();
  const slug = String(formData.get('slug'));
  const db = await getDb();
  const source = await getProjectBySlug(db, slug);
  if (!source) notFound();
  let dup;
  try {
    dup = await duplicateEvent(db, { sourceProjectId: source.id, actorUserId: user.id });
  } catch (e) {
    if (e instanceof EventCreationBlockedError) redirect(`/events/${slug}?error=${encodeURIComponent('You are not allowed to create events.')}`);
    throw e;
  }
  redirect(`/events/${dup.slug}/edit`);
}

export async function signUpAction(formData: FormData) {
  const user = await requireUser();
  const slug = String(formData.get('slug'));
  const db = await getDb();
  const project = await getProjectBySlug(db, slug);
  if (!project) notFound();
  await signUp(db, { eventProjectId: project.id, userId: user.id, seats: 1, note: null });
  revalidatePath(`/events/${slug}`);
  redirect(`/events/${slug}`);
}

export async function cancelSignupAction(formData: FormData) {
  const user = await requireUser();
  const slug = String(formData.get('slug'));
  const db = await getDb();
  const project = await getProjectBySlug(db, slug);
  if (!project) notFound();
  const { promoted } = await cancelSignup(db, { eventProjectId: project.id, userId: user.id });
  for (const row of promoted) {
    const [promotedUser] = await db.select().from(schema.user).where(eq(schema.user.id, row.userId));
    if (promotedUser) {
      await sendSignupPromotedEmail({
        to: promotedUser.email, eventTitle: project.title,
        eventUrl: `${process.env.PLATFORM_URL ?? 'http://localhost:3000'}/events/${slug}`,
      });
    }
  }
  revalidatePath(`/events/${slug}`);
  redirect(`/events/${slug}`);
}

async function transition(slug: string, to: ProjectStatus) {
  const user = await requireUser();
  const db = await getDb();
  const project = await getProjectBySlug(db, slug);
  if (!project) notFound();
  try {
    await assertEventPermission(db, project.id, user, 'manage');
    await transitionStatus(db, { projectId: project.id, to, actorUserId: user.id });
  } catch (e) {
    if (e instanceof NotAuthorizedError || e instanceof InvalidTransitionError || e instanceof IncompleteEventError) {
      redirect(`/events/${slug}?error=${encodeURIComponent(e.message)}`);
    }
    throw e;
  }
  revalidatePath(`/events/${slug}`);
  redirect(`/events/${slug}`);
}

export async function publishAction(formData: FormData) {
  await transition(String(formData.get('slug')), 'published');
}
export async function cancelEventAction(formData: FormData) {
  await transition(String(formData.get('slug')), 'cancelled');
}
export async function closeEventAction(formData: FormData) {
  await transition(String(formData.get('slug')), 'closed');
}
export async function archiveEventAction(formData: FormData) {
  await transition(String(formData.get('slug')), 'archived');
}
