import { notFound } from 'next/navigation';
import { getDb } from '@/db';
import { getEventDetails } from '@/lib/events/details-service';
import { buildEventIcs } from '@/lib/events/ical';
import { canViewEvent, getEventRole } from '@/lib/projects/authorization';
import { getProjectBySlug } from '@/lib/projects/service';
import { requireUser } from '@/lib/session';

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const user = await requireUser();
  const { slug } = await params;
  const db = await getDb();
  const project = await getProjectBySlug(db, slug);
  if (!project) notFound();
  const role = await getEventRole(db, project.id, user);
  if (!canViewEvent(project.status, role)) notFound();
  const details = await getEventDetails(db, project.id);
  if (!details) notFound();
  const ics = buildEventIcs({ uid: project.id, title: project.title, startsAt: details.startsAt, endsAt: details.endsAt, description: project.summary });
  return new Response(ics, { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
}
