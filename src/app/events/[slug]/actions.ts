'use server';

import { notFound, redirect } from 'next/navigation';
import { getDb } from '@/db';
import { duplicateEvent, EventCreationBlockedError, getProjectBySlug } from '@/lib/projects/service';
import { requireUser } from '@/lib/session';

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
