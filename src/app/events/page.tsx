import { and, eq } from 'drizzle-orm';
import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { EventsCalendar } from '@/components/events/events-calendar';
import { getDb, schema } from '@/db';
import type { EventDetails, Project } from '@/db/schema';
import { toCalendarEvents } from '@/lib/events/calendar-view';
import { getOrCreateIcalToken } from '@/lib/members/service';
import { listDraftEventsForUser } from '@/lib/projects/service';
import { canSeeEvents, requireUser } from '@/lib/session';
import { splitStockholmDateAndTime } from '@/lib/timezone';

export const dynamic = 'force-dynamic';

type EventRow = { project: Project; details: EventDetails | null };

function formatEventWhen(date: Date): string {
  const { date: d, time } = splitStockholmDateAndTime(date);
  return time ? `${d} ${time}` : d;
}

function EventTable({ items }: { items: EventRow[] }) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>When (Europe/Stockholm)</TableHead></TableRow></TableHeader>
      <TableBody>
        {items.map(({ project, details }) => (
          <TableRow key={project.id}>
            <TableCell><Link href={`/events/${project.slug}`} className="underline">{project.title}</Link></TableCell>
            <TableCell>{details ? formatEventWhen(details.startsAt) : '—'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default async function EventsPage() {
  const user = await requireUser();
  if (!(await canSeeEvents(user))) {
    return (
      <AppShell user={user}>
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Events are for members</CardTitle>
            <CardDescription>
              Events show here once you have paid the yearly membership fee. You can pay it on your <Link href="/" className="underline">home page</Link>.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            If you are a member (have paid the yearly fee within the last 12 months) but still get to this page you can
            contact Viktor Zaunders on the Alversjö Discord to try to figure it out.
          </CardContent>
        </Card>
      </AppShell>
    );
  }
  const db = await getDb();
  const icalToken = await getOrCreateIcalToken(db, user.id);
  const rows = await db.select({ project: schema.project, details: schema.eventDetails })
    .from(schema.project)
    .innerJoin(schema.eventDetails, eq(schema.eventDetails.projectId, schema.project.id))
    .where(and(eq(schema.project.kind, 'event'), eq(schema.project.status, 'published')));
  const draftRows = await listDraftEventsForUser(db, user.id);

  const now = new Date();
  const upcoming = rows.filter((r) => r.details.startsAt >= now).sort((a, b) => a.details.startsAt.getTime() - b.details.startsAt.getTime());
  const past = rows.filter((r) => r.details.startsAt < now).sort((a, b) => b.details.startsAt.getTime() - a.details.startsAt.getTime());

  return (
    <AppShell user={user}>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Events</h1>
        <div className="flex gap-4">
          <Tooltip>
            <TooltipTrigger
              className={buttonVariants({ variant: 'outline' })}
              render={<a href={`/events/members.ics?token=${icalToken}`} />}
            >
              Subscribe to all events
            </TooltipTrigger>
            <TooltipContent>Adds every published event to your calendar app, kept up to date automatically.</TooltipContent>
          </Tooltip>
          <Button render={<Link href="/events/new" />}>New event</Button>
        </div>
      </div>
      {draftRows.length > 0 && (
        <>
          <h2 className="mb-2 text-lg font-medium">Your drafts</h2>
          <EventTable items={draftRows} />
        </>
      )}
      <h2 className="mb-2 text-lg font-medium">Upcoming</h2>
      <EventTable items={upcoming} />
      <h2 className="mt-6 mb-2 text-lg font-medium">Past</h2>
      <EventTable items={past} />
      <h2 className="mt-6 mb-2 text-lg font-medium">Calendar</h2>
      <EventsCalendar events={toCalendarEvents(rows)} />
    </AppShell>
  );
}
