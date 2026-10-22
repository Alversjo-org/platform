'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { getDb } from '@/db';
import { InvalidCapacityError, upsertEventDetails } from '@/lib/events/details-service';
import { bookEventArea, removeEventArea } from '@/lib/areas/booking-service';
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
  const hasCapacityLimit = formData.get('capacityMode') === 'limited';
  const capacity = hasCapacityLimit ? Number(formData.get('capacity')) : null;
  const signupOpensRaw = String(formData.get('signupOpensAt') ?? '').trim();
  const signupClosesRaw = String(formData.get('signupClosesAt') ?? '').trim();
  const priceNoteRaw = String(formData.get('priceNote') ?? '').trim();
  const contactNoteRaw = String(formData.get('contactNote') ?? '').trim();
  try {
    await upsertEventDetails(db, {
      projectId: project.id,
      startsAt: new Date(String(formData.get('startsAt'))),
      endsAt: new Date(String(formData.get('endsAt'))),
      hasCapacityLimit,
      capacity,
      signupOpensAt: signupOpensRaw === '' ? null : new Date(signupOpensRaw),
      signupClosesAt: signupClosesRaw === '' ? null : new Date(signupClosesRaw),
      priceSek: Number(formData.get('priceSek') ?? 0) || 0,
      priceNote: priceNoteRaw === '' ? null : priceNoteRaw,
      contactNote: contactNoteRaw === '' ? null : contactNoteRaw,
      showSignupsToParticipants: formData.get('showSignupsToParticipants') !== null,
    });
  } catch (e) {
    if (e instanceof InvalidCapacityError) redirect(`/events/${slug}/edit?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath(`/events/${slug}/edit`);
  redirect(`/events/${slug}/edit`);
}

export async function bookAreaAction(formData: FormData) {
  const slug = String(formData.get('slug'));
  const { db, project } = await loadEditableProject(slug);
  const { overlaps } = await bookEventArea(db, {
    eventProjectId: project.id,
    areaId: String(formData.get('areaId')),
    from: new Date(String(formData.get('from'))),
    to: new Date(String(formData.get('to'))),
    setupNote: String(formData.get('setupNote') ?? '').trim() || null,
  });
  revalidatePath(`/events/${slug}/edit`);
  if (overlaps.length > 0) {
    const names = overlaps.map((o) => o.eventTitle).join(', ');
    redirect(`/events/${slug}/edit?warning=${encodeURIComponent(`Also booked by: ${names}`)}`);
  }
  redirect(`/events/${slug}/edit`);
}

export async function removeAreaAction(formData: FormData) {
  const slug = String(formData.get('slug'));
  const { db } = await loadEditableProject(slug);
  await removeEventArea(db, String(formData.get('eventAreaId')));
  revalidatePath(`/events/${slug}/edit`);
  redirect(`/events/${slug}/edit`);
}
