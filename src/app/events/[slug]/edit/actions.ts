'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { getDb } from '@/db';
import { getEventDetails, InvalidCapacityError, upsertEventDetails } from '@/lib/events/details-service';
import { parseEventDetailsForm } from '@/lib/events/parse-details-form';
import { bookEventAreas, removeEventArea } from '@/lib/areas/booking-service';
import { assertEventPermission, NotAuthorizedError } from '@/lib/projects/authorization';
import { getProjectBySlug, updateProjectMeta } from '@/lib/projects/service';
import { requireUser } from '@/lib/session';

async function loadEditableProject(slug: string) {
  const user = await requireUser();
  const db = await getDb();
  const project = await getProjectBySlug(db, slug);
  if (!project) notFound();
  try {
    await assertEventPermission(db, project.id, user, 'editDetails');
  } catch (e) {
    if (e instanceof NotAuthorizedError) redirect('/events');
    throw e;
  }
  return { db, project };
}

export async function updateEventMetaAction(formData: FormData) {
  const slug = String(formData.get('slug'));
  const { db, project } = await loadEditableProject(slug);
  await updateProjectMeta(db, {
    projectId: project.id,
    title: String(formData.get('title') ?? '').trim(),
    summary: String(formData.get('summary') ?? '').trim(),
    body: String(formData.get('body') ?? '').trim(),
  });
  revalidatePath(`/events/${slug}/edit`);
  redirect(`/events/${slug}/edit`);
}

export async function updateEventDetailsAction(formData: FormData) {
  const slug = String(formData.get('slug'));
  const { db, project } = await loadEditableProject(slug);
  try {
    await upsertEventDetails(db, { projectId: project.id, ...parseEventDetailsForm(formData) });
  } catch (e) {
    if (e instanceof InvalidCapacityError) redirect(`/events/${slug}/edit?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath(`/events/${slug}/edit`);
  redirect(`/events/${slug}/edit`);
}

export async function bookAreasAction(formData: FormData) {
  const slug = String(formData.get('slug'));
  const { db, project } = await loadEditableProject(slug);
  const details = await getEventDetails(db, project.id);
  if (!details) redirect(`/events/${slug}/edit?error=${encodeURIComponent('Save the event details before booking areas.')}`);
  const areaIds = formData.getAll('areaIds').map(String);
  const { overlaps } = await bookEventAreas(db, { eventProjectId: project.id, areaIds, from: details.startsAt, to: details.endsAt });
  revalidatePath(`/events/${slug}/edit`);
  if (overlaps.length > 0) {
    const names = [...new Set(overlaps.map((o) => o.eventTitle))].join(', ');
    redirect(`/events/${slug}/edit?warning=${encodeURIComponent(`Also booked by: ${names}`)}`);
  }
  redirect(`/events/${slug}/edit`);
}

export async function removeAreaAction(formData: FormData) {
  const slug = String(formData.get('slug'));
  const { db, project } = await loadEditableProject(slug);
  await removeEventArea(db, { eventAreaId: String(formData.get('eventAreaId')), eventProjectId: project.id });
  revalidatePath(`/events/${slug}/edit`);
  redirect(`/events/${slug}/edit`);
}
