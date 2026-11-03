import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { Backdrop } from '@/components/backdrop';
import { DateBlob, weekdayTime } from '@/components/date-blob';
import { MonthCalendar } from '@/components/events/month-calendar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getDb } from '@/db';
import { toCalendarDays } from '@/lib/events/calendar-days';
import { listPublishedEvents, summarizeEvents, type EventSummary } from '@/lib/events/coming-up';
import { getOrCreateIcalToken } from '@/lib/members/service';
import { listDraftEventsForUser } from '@/lib/projects/service';
import { canSeeEvents, requireUser } from '@/lib/session';
import { utcToStockholmWallClock } from '@/lib/timezone';
import { publishAction } from './[slug]/actions';

export const dynamic = 'force-dynamic';

const NIGHT = <Backdrop photo="night" blur={9} wash="linear-gradient(180deg, rgb(10 6 26 / 0.2) 0%, rgb(10 6 26 / 0.8) 100%)" />;

function meta(e: EventSummary): string {
  return [weekdayTime(e.startsAt), e.areas.join(', '), `${e.going} going`].filter(Boolean).join(' · ');
}

function Label({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold tracking-[0.08em] text-white/70 uppercase">{children}</h2>;
}

function EventRow({ event, past = false }: { event: EventSummary; past?: boolean }) {
  return (
    <Link
      href={`/events/${event.slug}`}
      className="glass flex items-center gap-4 rounded-[24px] py-3 pr-5 pl-3 transition-colors hover:bg-night/60 md:gap-5 md:rounded-[30px] md:py-3.5 md:pr-6 md:pl-3.5"
    >
      <DateBlob date={event.startsAt} variant={past ? 'muted' : 'lantern'} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[17px] font-semibold md:text-lg">{event.title}</p>
        <p className="truncate text-sm text-white/70">{meta(event)}</p>
      </div>
      <span aria-hidden className="hidden text-xl text-white/60 md:block">→</span>
    </Link>
  );
}

export default async function EventsPage() {
  const user = await requireUser();
  if (!(await canSeeEvents(user))) {
    return (
      <AppShell user={user} theme="dark" backdrop={NIGHT}>
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
  const events = await listPublishedEvents(db);
  const draftRows = await listDraftEventsForUser(db, user.id);
  const drafts = await summarizeEvents(db, draftRows.flatMap(({ project, details }) => details
    ? [{ id: project.id, slug: project.slug, title: project.title, startsAt: details.startsAt, endsAt: details.endsAt }]
    : []));
  const undated = draftRows.filter((r) => !r.details).map((r) => r.project);

  const now = new Date();
  const upcoming = events.filter((e) => e.startsAt >= now);
  const past = events.filter((e) => e.startsAt < now).reverse();
  const today = utcToStockholmWallClock(now).slice(0, 10);

  return (
    <AppShell user={user} theme="dark" backdrop={NIGHT}>
      <div className="flex flex-wrap items-center gap-4 md:items-start md:px-10">
        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-[52px] leading-none font-bold md:text-[64px]">Events</h1>
          <p className="mt-2 hidden text-[17px] text-white/80 md:block">What’s happening on the land. Times are Swedish time.</p>
        </div>
        <div className="flex gap-3 md:mt-3.5">
          <div className="hidden md:block">
            <Tooltip>
              <TooltipTrigger render={<Button variant="outline" size="lg" nativeButton={false} render={<a href={`/events/members.ics?token=${icalToken}`} />} />}>
                Add to my calendar
              </TooltipTrigger>
              <TooltipContent>Adds every published event to your calendar app, kept up to date automatically.</TooltipContent>
            </Tooltip>
          </div>
          <Button size="lg" nativeButton={false} render={<Link href="/events/new" />}>New event</Button>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-6 md:mt-10 md:flex-row md:items-start md:gap-10 md:px-10">
        <div className="order-2 flex min-w-0 flex-1 flex-col gap-3 md:order-1">
          {(drafts.length > 0 || undated.length > 0) && (
            <>
              <Label>Your drafts</Label>
              {drafts.map((e) => (
                <div key={e.slug} className="glass flex items-center gap-4 rounded-[24px] py-3 pr-3 pl-3 md:gap-5 md:rounded-[30px] md:py-3.5 md:pr-6 md:pl-3.5">
                  <DateBlob date={e.startsAt} variant="muted" />
                  <Link href={`/events/${e.slug}`} className="min-w-0 flex-1">
                    <p className="truncate text-[17px] font-semibold md:text-lg">{e.title}</p>
                    <p className="truncate text-sm text-sun">Draft · only you can see this</p>
                  </Link>
                  <form action={publishAction} className="hidden md:block">
                    <input type="hidden" name="slug" value={e.slug} />
                    <Button type="submit" size="sm" className="h-11 px-5">Publish</Button>
                  </form>
                </div>
              ))}
              {undated.map((p) => (
                <Link key={p.id} href={`/events/${p.slug}/edit`} className="glass flex items-center gap-4 rounded-[24px] p-4 md:rounded-[30px]">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-lg font-semibold">{p.title}</p>
                    <p className="text-sm text-sun">Draft · add a date to publish it</p>
                  </div>
                </Link>
              ))}
              <div className="h-3" />
            </>
          )}
          <Label>Upcoming</Label>
          {upcoming.length === 0 && <p className="text-white/70">Nothing planned yet.</p>}
          {upcoming.map((e) => <EventRow key={e.slug} event={e} />)}
          <Button variant="outline" className="mt-2 md:hidden" nativeButton={false} render={<a href={`/events/members.ics?token=${icalToken}`} />}>
            Add to my calendar
          </Button>
          {past.length > 0 && (
            <details className="group mt-3">
              <summary className="cursor-pointer list-none py-2 text-xs font-semibold tracking-[0.08em] text-white/70 uppercase">
                Past ({past.length}) <span className="group-open:hidden">↓</span><span className="hidden group-open:inline">↑</span>
              </summary>
              <div className="mt-2 flex flex-col gap-3">
                {past.map((e) => <EventRow key={e.slug} event={e} past />)}
              </div>
            </details>
          )}
        </div>
        <div className="order-1 w-full md:order-2 md:w-[480px] md:shrink-0">
          <MonthCalendar days={toCalendarDays(events)} today={today} />
        </div>
      </div>
    </AppShell>
  );
}
