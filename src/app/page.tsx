import { eq } from 'drizzle-orm';
import Image from 'next/image';
import Link from 'next/link';
import { getDb, schema } from '@/db';
import { AppShell } from '@/components/app-shell';
import { Backdrop } from '@/components/backdrop';
import { DateBlob, weekdayTime } from '@/components/date-blob';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { listComingUp } from '@/lib/events/coming-up';
import { isActiveNow } from '@/lib/members/status';
import { canSeeEvents, requireUser } from '@/lib/session';
import { startCheckoutAction } from './actions';

export const dynamic = 'force-dynamic';

const day = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Stockholm' });

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string; checkout?: string }> }) {
  const sessionUser = await requireUser();
  const { error, checkout } = await searchParams;
  const db = await getDb();
  const [member] = await db.select().from(schema.user).where(eq(schema.user.id, sessionUser.id));
  const active = isActiveNow(member);
  const comingUp = (await canSeeEvents(sessionUser)) ? await listComingUp(db, new Date()) : null;
  const firstName = member.nickname || member.name.trim().split(/\s+/)[0] || '';

  return (
    <AppShell
      user={sessionUser}
      backdrop={<Backdrop photo="gateKeepers" wash="linear-gradient(180deg, rgb(11 26 51 / 0.33) 0%, rgb(11 26 51 / 0) 100%)" />}
      className="flex flex-col md:pt-[74px]"
    >
      <div className="mb-8 flex items-center gap-2 md:hidden">
        <Image src="/alversjo-logo.png" alt="" width={36} height={36} className="size-9" />
        <span className="font-serif text-xl font-bold text-white">Alversjö</span>
      </div>
      {active && (
        <p className="glass mb-6 self-start rounded-full px-5 py-2.5 text-[15px] text-ink md:mx-10 md:-mt-10 md:mb-10">
          Membership paid until: <span className="font-semibold">{day(member.membershipExpiresAt!)}</span>
        </p>
      )}
      <div className="flex flex-col gap-2 text-white md:gap-2.5 md:px-10 [text-shadow:0_4px_24px_rgb(0_0_0/0.25)]">
        <h1 className="font-serif text-[44px] leading-[1.05] font-bold md:text-[72px]">
          Welcome home{firstName ? `, ${firstName}` : ''}
        </h1>
        <p className="font-serif text-[22px] italic opacity-90 md:text-[28px]">Let’s make beauty together.</p>
      </div>

      <div className="mt-auto flex flex-col gap-4 pt-16 md:flex-row md:items-end md:px-10 md:pt-24">
        {(error || checkout) && (
          <div className="md:hidden">
            <Notices error={error} checkout={checkout} />
          </div>
        )}
        {comingUp && (
          <section className="glass flex w-full flex-col gap-1 rounded-[30px] px-3.5 pt-[18px] pb-3.5 md:max-w-[540px] md:gap-1.5 md:rounded-[32px] md:px-6 md:pt-6 md:pb-5">
            <div className="flex items-center px-1.5 pb-1.5 md:px-0">
              <h2 className="text-xs font-semibold tracking-[0.08em] text-ink-soft uppercase">Coming up</h2>
              <div className="flex-1" />
              <Link href="/events" className="px-1 py-3 text-sm font-semibold text-forest">All events →</Link>
            </div>
            {comingUp.length === 0 && <p className="px-2 pb-3 text-sm text-ink-soft">Nothing planned yet.</p>}
            {comingUp.map((e) => (
              <Link key={e.slug} href={`/events/${e.slug}`} className="flex items-center gap-4 rounded-3xl p-2 transition-colors hover:bg-forest/5">
                <DateBlob date={e.startsAt} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold text-ink">{e.title}</p>
                  <p className="truncate text-sm text-ink-soft">
                    {[weekdayTime(e.startsAt), e.areas.join(', '), `${e.going} going`].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </Link>
            ))}
          </section>
        )}
        {active ? (
          (error || checkout) && (
            <div className="hidden md:block">
              <Notices error={error} checkout={checkout} />
            </div>
          )
        ) : (
          <section className="glass flex w-full flex-col gap-4 rounded-[30px] p-6 md:max-w-[400px] md:rounded-[32px]">
            <div className="hidden md:block">
              <Notices error={error} checkout={checkout} />
            </div>
            <div>
              <h2 className="text-xs font-semibold tracking-[0.08em] text-ink-soft uppercase">Membership</h2>
              <p className="mt-2 text-base text-ink">
                {member.membershipExpiresAt && member.membershipExpiresAt <= new Date()
                  ? `Membership expired on ${day(member.membershipExpiresAt)}`
                  : 'You are not yet a member.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <form action={startCheckoutAction}>
                <input type="hidden" name="plan" value="yearly" />
                <Button type="submit">Pay yearly</Button>
              </form>
              <form action={startCheckoutAction}>
                <input type="hidden" name="plan" value="monthly" />
                <Button type="submit" variant="outline">Pay monthly</Button>
              </form>
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}

function Notices({ error, checkout }: { error?: string; checkout?: string }) {
  return (
    <>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {checkout === 'cancelled' && <Alert><AlertDescription>Checkout was cancelled.</AlertDescription></Alert>}
      {checkout === 'success' && <Alert><AlertDescription>Payment received — your membership will update shortly.</AlertDescription></Alert>}
    </>
  );
}
