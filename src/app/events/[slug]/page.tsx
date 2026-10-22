import { eq, inArray } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getDb, schema } from '@/db';
import { listEventAreas } from '@/lib/areas/booking-service';
import { listAreas } from '@/lib/areas/service';
import { getEventDetails } from '@/lib/events/details-service';
import { listSignups } from '@/lib/events/signup-service';
import { ALLOWED_TRANSITIONS, getProjectBySlug } from '@/lib/projects/service';
import { getEventRole } from '@/lib/projects/authorization';
import { requireUser } from '@/lib/session';
import {
  archiveEventAction, cancelEventAction, cancelSignupAction, closeEventAction, duplicateEventAction, publishAction, signUpAction,
} from './actions';

export const dynamic = 'force-dynamic';

export default async function EventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug } = await params;
  const { error } = await searchParams;
  const user = await requireUser();
  const db = await getDb();
  const project = await getProjectBySlug(db, slug);
  if (!project) notFound();

  const details = await getEventDetails(db, project.id);
  const bookings = await listEventAreas(db, project.id);
  const areas = await listAreas(db);
  const role = await getEventRole(db, project.id, user);
  const isOrganiser = role !== null;
  const canManage = role === 'lead' || role === 'override';
  const allSignups = await listSignups(db, project.id);
  const mySignup = allSignups.find((s) => s.userId === user.id && s.status !== 'cancelled');
  const going = allSignups.filter((s) => s.status === 'going');
  const waitlisted = allSignups.filter((s) => s.status === 'waitlist');
  const signupUsers = allSignups.length > 0
    ? await db.select({ id: schema.user.id, name: schema.user.name, nickname: schema.user.nickname }).from(schema.user)
      .where(inArray(schema.user.id, allSignups.map((s) => s.userId)))
    : [];
  const signupNames = new Map(signupUsers.map((u) => [u.id, u.nickname || u.name || u.id]));
  const showAttendeeList = isOrganiser || details?.showSignupsToParticipants;
  const allowedNext = ALLOWED_TRANSITIONS[project.status];

  return (
    <AppShell user={user}>
      {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="mb-2 flex items-center gap-2">
        <h1 className="text-xl font-semibold">{project.title}</h1>
        <Badge variant="secondary">{project.status}</Badge>
      </div>
      {project.summary && <p className="mb-4 text-muted-foreground">{project.summary}</p>}
      {project.body && <p className="mb-4 whitespace-pre-wrap">{project.body}</p>}

      {details && (
        <div className="mb-4 space-y-1 text-sm">
          <p>When: {details.startsAt.toISOString()} – {details.endsAt.toISOString()}</p>
          <p>Capacity: {details.hasCapacityLimit ? details.capacity : 'No limit'}</p>
          <p>Price: {details.priceSek === 0 ? 'Free' : `${details.priceSek} öre`}{details.priceNote ? ` — ${details.priceNote}` : ''}</p>
          {bookings.length > 0 && (
            <p>Areas: {bookings.map((b) => areas.find((a) => a.id === b.areaId)?.name ?? b.areaId).join(', ')}</p>
          )}
        </div>
      )}

      {project.status === 'published' && (
        mySignup ? (
          <form action={cancelSignupAction} className="mb-4">
            <input type="hidden" name="slug" value={slug} />
            <p className="mb-2 text-sm">You are {mySignup.status === 'going' ? 'going' : 'on the waitlist'}.</p>
            <Button type="submit" variant="secondary">Cancel sign-up</Button>
          </form>
        ) : (
          <form action={signUpAction} className="mb-4">
            <input type="hidden" name="slug" value={slug} />
            <Button type="submit">Sign up</Button>
          </form>
        )
      )}

      <p className="mb-4 text-sm text-muted-foreground">{going.length} going, {waitlisted.length} on the waitlist</p>

      <a href={`/events/${slug}/ics`} className="mb-4 inline-block text-sm underline">Add to calendar</a>

      {isOrganiser && (
        <div className="mb-4 flex flex-wrap gap-4 text-sm">
          <Link href={`/events/${slug}/edit`} className="underline">Edit</Link>
          <form action={duplicateEventAction}><input type="hidden" name="slug" value={slug} /><button type="submit" className="underline">Duplicate as new event</button></form>
          <a href={`/events/${slug}/signups.csv`} className="underline">Export sign-ups (CSV)</a>
        </div>
      )}

      {canManage && (
        <div className="mb-6 flex flex-wrap gap-2">
          {allowedNext.includes('published') && <form action={publishAction}><input type="hidden" name="slug" value={slug} /><Button type="submit" size="sm">Publish</Button></form>}
          {allowedNext.includes('cancelled') && <form action={cancelEventAction}><input type="hidden" name="slug" value={slug} /><Button type="submit" size="sm" variant="secondary">Cancel event</Button></form>}
          {allowedNext.includes('closed') && <form action={closeEventAction}><input type="hidden" name="slug" value={slug} /><Button type="submit" size="sm" variant="secondary">Close</Button></form>}
          {allowedNext.includes('archived') && <form action={archiveEventAction}><input type="hidden" name="slug" value={slug} /><Button type="submit" size="sm" variant="secondary">Archive</Button></form>}
        </div>
      )}

      {showAttendeeList && (
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead>Seats</TableHead>{isOrganiser && <TableHead>Note</TableHead>}</TableRow></TableHeader>
          <TableBody>
            {allSignups.filter((s) => s.status !== 'cancelled').map((s) => (
              <TableRow key={s.userId}>
                <TableCell>{signupNames.get(s.userId)}</TableCell>
                <TableCell>{s.status}</TableCell>
                <TableCell>{s.seats}</TableCell>
                {isOrganiser && <TableCell>{s.note ?? '—'}</TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </AppShell>
  );
}
