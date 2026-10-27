'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import { bookEventAreas } from '@/lib/areas/booking-service';
import { InvalidCapacityError, upsertEventDetails } from '@/lib/events/details-service';
import { parseEventDetailsForm } from '@/lib/events/parse-details-form';
import { createEvent, EventCreationBlockedError } from '@/lib/projects/service';
import { requireUser } from '@/lib/session';

export async function createEventAction(formData: FormData) {
  const user = await requireUser();
  const title = String(formData.get('title') ?? '').trim();
  const summary = String(formData.get('summary') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  const db = await getDb();
  let project;
  try {
    project = await createEvent(db, { title, summary, body, ownerUserId: user.id });
  } catch (e) {
    if (e instanceof EventCreationBlockedError) redirect(`/events/new?error=${encodeURIComponent('You are not allowed to create events.')}`);
    throw e;
  }
  const details = parseEventDetailsForm(formData);
  try {
    await upsertEventDetails(db, { projectId: project.id, ...details });
  } catch (e) {
    // The draft already exists at this point; let the organiser fix the details on the edit page rather than losing the draft.
    if (e instanceof InvalidCapacityError) redirect(`/events/${project.slug}/edit?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  const areaIds = formData.getAll('areaIds').map(String);
  if (areaIds.length > 0) {
    await bookEventAreas(db, { eventProjectId: project.id, areaIds, from: details.startsAt, to: details.endsAt });
  }
  redirect(`/events/${project.slug}/edit`);
}
