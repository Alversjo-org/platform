import { and, eq } from 'drizzle-orm';
import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getDb, schema } from '@/db';
import type { EventDetails, Project } from '@/db/schema';
import { getOrCreateIcalToken } from '@/lib/members/service';
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

type EventRow = { project: Project; details: EventDetails };

function EventTable({ items }: { items: EventRow[] }) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>When</TableHead></TableRow></TableHeader>
      <TableBody>
        {items.map(({ project, details }) => (
          <TableRow key={project.id}>
            <TableCell><Link href={`/events/${project.slug}`} className="underline">{project.title}</Link></TableCell>
            <TableCell>{details.startsAt.toISOString()}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default async function EventsPage() {
  const user = await requireUser();
  const db = await getDb();
  const icalToken = await getOrCreateIcalToken(db, user.id);
  const rows = await db.select({ project: schema.project, details: schema.eventDetails })
    .from(schema.project)
    .innerJoin(schema.eventDetails, eq(schema.eventDetails.projectId, schema.project.id))
    .where(and(eq(schema.project.kind, 'event'), eq(schema.project.status, 'published')));

  const now = new Date();
  const upcoming = rows.filter((r) => r.details.startsAt >= now).sort((a, b) => a.details.startsAt.getTime() - b.details.startsAt.getTime());
  const past = rows.filter((r) => r.details.startsAt < now).sort((a, b) => b.details.startsAt.getTime() - a.details.startsAt.getTime());

  return (
    <AppShell user={user}>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Events</h1>
        <div className="flex gap-4">
          <a href={`/events/members.ics?token=${icalToken}`} className="text-sm underline">Subscribe to all events</a>
          <Link href="/events/new" className="text-sm underline">New event</Link>
        </div>
      </div>
      <h2 className="mb-2 text-lg font-medium">Upcoming</h2>
      <EventTable items={upcoming} />
      <h2 className="mt-6 mb-2 text-lg font-medium">Past</h2>
      <EventTable items={past} />
    </AppShell>
  );
}
