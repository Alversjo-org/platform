import { inArray } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { Backdrop } from '@/components/backdrop';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getDb, schema } from '@/db';
import { listEventAreas } from '@/lib/areas/booking-service';
import { listAreas } from '@/lib/areas/service';
import { getEventDetails } from '@/lib/events/details-service';
import { formatEventSpan } from '@/lib/events/format';
import { listSignups } from '@/lib/events/signup-service';
import { oreToSek } from '@/lib/money';
import { ALLOWED_TRANSITIONS, getProjectBySlug } from '@/lib/projects/service';
import { canViewEvent, getEventRole } from '@/lib/projects/authorization';
import { requireEventAccess } from '@/lib/session';
import { cn } from 'cn';
import {
  archiveEventAction, cancelEventAction, cancelSignupAction, closeEventAction, duplicateEventAction, publishAction, signUpAction,
} from './actions';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = { draft: 'Draft', published: 'Published', cancelled: 'Cancelled', closed: 'Closed', archived: 'Archived' };
// Avatar colours in the stack, after sun.
const STACK = ['bg-sun', 'bg-[#9ed8b4]', 'bg-[#f2a37a]', 'bg-[#b9a6f2]'];

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass flex flex-col gap-1 rounded-[22px] px-5 py-4">
      <span className="text-xs font-semibold tracking-[0.08em] text-white/65 uppercase">{label}</span>
      <span className="text-base font-semibold">{value}</span>
    </div>
  );
}

export default async function EventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug } = await params;
  const { error } = await searchParams;
  const user = await requireEventAccess();
  const db = await getDb();
  const project = await getProjectBySlug(db, slug);
  if (!project) notFound();
  const role = await getEventRole(db, project.id, user);
  if (!canViewEvent(project.status, role)) notFound();

  const details = await getEventDetails(db, project.id);
  const bookings = await listEventAreas(db, project.id);
  const areas = await listAreas(db);
  const isOrganiser = role !== null;
  const canManage = role === 'lead' || role === 'override';
  const allSignups = await listSignups(db, project.id);
  const mySignup = allSignups.find((s) => s.userId === user.id && s.status !== 'cancelled');
  const going = allSignups.filter((s) => s.status === 'going');
  const waitlisted = allSignups.filter((s) => s.status === 'waitlist');
  const goingSeats = going.reduce((n, s) => n + s.seats, 0);
  const waitlistSeats = waitlisted.reduce((n, s) => n + s.seats, 0);
  const signupUsers = allSignups.length > 0
    ? await db.select({ id: schema.user.id, name: schema.user.name, nickname: schema.user.nickname, email: schema.user.email, image: schema.user.image })
      .from(schema.user).where(inArray(schema.user.id, allSignups.map((s) => s.userId)))
    : [];
  const people = new Map(signupUsers.map((u) => [u.id, u]));
  const showAttendeeList = isOrganiser || details?.showSignupsToParticipants;
  const allowedNext = ALLOWED_TRANSITIONS[project.status];
  const areaNames = [...new Set(bookings.map((b) => areas.find((a) => a.id === b.areaId)?.name ?? b.areaId))];
  const stack = going.slice(0, 4).map((s) => people.get(s.userId)).filter((u) => u !== undefined);
  const counts = [`${goingSeats} going`, waitlistSeats > 0 ? `${waitlistSeats} on the waitlist` : null].filter(Boolean).join(' · ');

  const avatars = (
    <div className="flex -space-x-2">
      {stack.map((u, i) => (
        <Avatar key={u.id} image={u.image} name={u.name} email={u.email} className={cn('size-10 text-sm text-ink ring-2 ring-night', STACK[i])} />
      ))}
      {going.length > stack.length && (
        <span className="flex size-10 items-center justify-center rounded-full bg-white text-sm font-semibold text-ink ring-2 ring-night">+{going.length - stack.length}</span>
      )}
    </div>
  );
  const signupForm = (size: 'lg' | 'default') => project.status === 'published' && (
    mySignup ? (
      <form action={cancelSignupAction}>
        <input type="hidden" name="slug" value={slug} />
        <Button type="submit" variant="outline" size={size} className="w-full">{size === 'lg' ? 'Cancel my place' : 'Cancel'}</Button>
      </form>
    ) : (
      <form action={signUpAction}>
        <input type="hidden" name="slug" value={slug} />
        <Button type="submit" size={size} className="w-full px-6">Sign up</Button>
      </form>
    )
  );

  return (
    <AppShell
      user={user}
      theme="dark"
      tabBar={false}
      backdrop={<Backdrop photo="night" wash="linear-gradient(180deg, rgb(10 6 26 / 0) 0%, rgb(10 6 26 / 0.9) 100%)" />}
      className="pb-36 md:pb-16"
    >
      <Link href="/events" aria-label="All events" className="glass flex size-11 items-center justify-center rounded-full text-xl md:hidden">←</Link>
      <Link href="/events" className="hidden self-start px-2 py-3 text-[15px] font-medium text-white/85 md:-mt-5 md:ml-8 md:block">← All events</Link>
      {error && <Alert variant="destructive" className="mt-4"><AlertDescription>{error}</AlertDescription></Alert>}

      <div className="flex min-h-[calc(100svh-15rem)] flex-col justify-end gap-8 md:min-h-[calc(100svh-23rem)] md:flex-row md:items-end md:justify-between md:px-10">
        <div className="flex max-w-[840px] flex-col items-start gap-4 md:gap-[18px]">
          <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', project.status === 'published' ? 'bg-sun/95 text-ink' : 'bg-white/15 text-white')}>
            {STATUS_LABEL[project.status] ?? project.status}
          </span>
          <h1 className="font-serif text-[40px] leading-[1.05] font-bold text-balance md:text-[64px]">{project.title}</h1>
          {project.summary && <p className="max-w-[640px] text-[17px] leading-relaxed text-white/85 md:text-[19px]">{project.summary}</p>}
          {details && (
            <div className="grid w-full grid-cols-2 gap-3 pt-3 md:flex md:w-auto md:flex-wrap">
              <Fact label="When" value={formatEventSpan(details.startsAt, details.endsAt)} />
              <Fact label="Capacity" value={details.hasCapacityLimit ? `${details.capacity} places` : 'No limit'} />
              <Fact label="Price" value={details.priceSek === 0 ? 'Free' : `${oreToSek(details.priceSek)} kr`} />
              {areaNames.length > 0 && <Fact label={areaNames.length > 1 ? 'Areas' : 'Area'} value={areaNames.join(', ')} />}
            </div>
          )}
          <a href={`/events/${slug}/ics`} className="text-[15px] text-white/85 underline underline-offset-4 md:hidden">Add this event to my calendar</a>
        </div>

        <aside className="glass hidden w-[380px] shrink-0 flex-col gap-4 rounded-[28px] p-8 md:flex">
          <h2 className="font-serif text-[28px] font-bold">Join us</h2>
          {stack.length > 0 && avatars}
          <p className="text-[15px] text-white/80">{counts}</p>
          {mySignup && <p className="text-[15px] font-semibold text-sun">{mySignup.status === 'going' ? 'You have a place.' : 'You’re on the waitlist.'}</p>}
          {signupForm('lg')}
          <a href={`/events/${slug}/ics`} className="pt-2 text-sm text-white/85 underline underline-offset-4">Add this event to my calendar</a>
        </aside>
      </div>

      {project.body && project.body !== project.summary && (
        <section className="glass mt-8 max-w-[840px] rounded-[28px] p-6 md:mx-10 md:p-8">
          <p className="text-base leading-relaxed whitespace-pre-wrap text-white/90">{project.body}</p>
          {details?.priceNote && <p className="mt-3 text-sm text-white/70">Price: {details.priceNote}</p>}
        </section>
      )}

      {(isOrganiser || canManage) && (
        <section className="glass mt-6 flex flex-col gap-4 rounded-[28px] p-6 md:mx-10 md:p-8">
          <h2 className="font-serif text-xl font-bold">Organise</h2>
          <div className="flex flex-wrap gap-2">
            {isOrganiser && <Button variant="outline" nativeButton={false} render={<Link href={`/events/${slug}/edit`} />}>Edit</Button>}
            {isOrganiser && <form action={duplicateEventAction}><input type="hidden" name="slug" value={slug} /><Button type="submit" variant="outline">Duplicate as new event</Button></form>}
            {isOrganiser && <Button variant="outline" nativeButton={false} render={<a href={`/events/${slug}/signups.csv`} />}>Export sign-ups (CSV)</Button>}
            {canManage && allowedNext.includes('published') && <form action={publishAction}><input type="hidden" name="slug" value={slug} /><Button type="submit">Publish</Button></form>}
            {canManage && allowedNext.includes('closed') && <form action={closeEventAction}><input type="hidden" name="slug" value={slug} /><Button type="submit" variant="outline">Close sign-ups</Button></form>}
            {canManage && allowedNext.includes('cancelled') && <form action={cancelEventAction}><input type="hidden" name="slug" value={slug} /><Button type="submit" variant="destructive">Cancel event</Button></form>}
            {canManage && allowedNext.includes('archived') && <form action={archiveEventAction}><input type="hidden" name="slug" value={slug} /><Button type="submit" variant="outline">Archive</Button></form>}
          </div>
        </section>
      )}

      {showAttendeeList && allSignups.some((s) => s.status !== 'cancelled') && (
        <section className="glass mt-6 flex flex-col gap-3 rounded-[28px] p-6 md:mx-10 md:p-8">
          <h2 className="font-serif text-xl font-bold">Who’s coming</h2>
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead>Seats</TableHead>{isOrganiser && <TableHead>Note</TableHead>}</TableRow></TableHeader>
              <TableBody>
                {allSignups.filter((s) => s.status !== 'cancelled').map((s) => {
                  const u = people.get(s.userId);
                  return (
                    <TableRow key={s.userId}>
                      <TableCell>{u ? u.nickname || u.name || u.email : s.userId}</TableCell>
                      <TableCell>{s.status}</TableCell>
                      <TableCell className="tabular">{s.seats}</TableCell>
                      {isOrganiser && <TableCell>{s.note ?? '—'}</TableCell>}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
        </section>
      )}

      {/* Phones: Sign up lives in a bar fixed to the bottom, in place of the tab bar. */}
      {project.status === 'published' && (
        <div className="glass fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 flex items-center gap-3 rounded-[32px] p-4 md:hidden">
          {!mySignup && stack.length > 0 && <div className="shrink-0">{avatars}</div>}
          <div className="min-w-0 flex-1">
            <p className={cn('truncate text-base font-semibold', mySignup && 'text-sun')}>
              {mySignup ? (mySignup.status === 'going' ? 'You have a place' : 'On the waitlist') : `${goingSeats} going`}
            </p>
            <p className="truncate text-sm text-white/70">{mySignup ? counts : waitlistSeats > 0 ? `${waitlistSeats} on the waitlist` : 'Be one of them'}</p>
          </div>
          <div className="shrink-0">{signupForm('default')}</div>
        </div>
      )}
    </AppShell>
  );
}
