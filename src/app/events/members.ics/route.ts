import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { buildFeedIcs } from '@/lib/events/ical';
import { getUserByIcalToken } from '@/lib/members/service';

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token');
  if (!token) return new Response(null, { status: 404 });
  const db = await getDb();
  const user = await getUserByIcalToken(db, token);
  if (!user) return new Response(null, { status: 404 });

  const rows = await db.select({ project: schema.project, details: schema.eventDetails })
    .from(schema.project)
    .innerJoin(schema.eventDetails, eq(schema.eventDetails.projectId, schema.project.id))
    .where(and(eq(schema.project.kind, 'event'), eq(schema.project.status, 'published')));

  const ics = buildFeedIcs(rows.map(({ project, details }) => ({
    uid: project.id, title: project.title, startsAt: details.startsAt, endsAt: details.endsAt, description: project.summary,
  })));
  return new Response(ics, { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
}
