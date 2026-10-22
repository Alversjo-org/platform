import { notFound } from 'next/navigation';
import { getDb } from '@/db';
import { getEventDetails } from '@/lib/events/details-service';
import { buildEventIcs } from '@/lib/events/ical';
import { getProjectBySlug } from '@/lib/projects/service';
import { requireUser } from '@/lib/session';

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  await requireUser();
  const { slug } = await params;
  const db = await getDb();
  const project = await getProjectBySlug(db, slug);
  if (!project) notFound();
  const details = await getEventDetails(db, project.id);
  if (!details) notFound();
  const ics = buildEventIcs({ uid: project.id, title: project.title, startsAt: details.startsAt, endsAt: details.endsAt, description: project.summary });
  return new Response(ics, { headers: { 'Content-Type': 'text/calendar' } });
}
