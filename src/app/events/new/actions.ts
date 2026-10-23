'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import { createEvent, EventCreationBlockedError } from '@/lib/projects/service';
import { requireUser } from '@/lib/session';

export async function createEventAction(formData: FormData) {
  const user = await requireUser();
  const title = String(formData.get('title') ?? '').trim();
  const summary = String(formData.get('summary') ?? '').trim();
  let project;
  try {
    project = await createEvent(await getDb(), { title, summary, ownerUserId: user.id });
  } catch (e) {
    if (e instanceof EventCreationBlockedError) redirect(`/events/new?error=${encodeURIComponent('You are not allowed to create events.')}`);
    throw e;
  }
  redirect(`/events/${project.slug}/edit`);
}
