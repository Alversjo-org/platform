import { eq } from 'drizzle-orm';
import { AppShell } from '@/components/app-shell';
import { Backdrop } from '@/components/backdrop';
import { FinanceTabs } from '@/components/finance-tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { getDb, schema } from '@/db';
import { getConnection } from '@/lib/fortnox/connection-service';
import { requireTreasurer } from '@/lib/session';
import { cn } from 'cn';
import { connectAction, disconnectAction, runFirstImportAction } from './actions';

export const dynamic = 'force-dynamic';

const TOPICS: Record<string, string> = { vouchers: 'Vouchers', projects: 'Projects', 'cost-centers': 'Cost centres', 'financial-years': 'Financial years' };
const when = (d: Date) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Stockholm' }).format(d);
const day = (d: Date) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Stockholm' }).format(d);

function Dot({ tone }: { tone: 'teal' | 'sun' | 'grey' }) {
  return <span className={cn('size-3 shrink-0 rounded-full', tone === 'teal' && 'bg-teal shadow-[0_0_10px_var(--teal)]', tone === 'sun' && 'bg-sun', tone === 'grey' && 'bg-white/45')} />;
}

export default async function FortnoxPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const treasurer = await requireTreasurer();
  const db = await getDb();
  const connection = await getConnection(db);
  const syncState = await db.select().from(schema.fxSyncState);
  const { error } = await searchParams;
  const status = connection?.status ?? 'disconnected';
  const [connectedBy] = connection?.connectedByUserId
    ? await db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, connection.connectedByUserId))
    : [];

  return (
    <AppShell user={treasurer} theme="dark" backdrop={<Backdrop photo="bonfire" blur={5} wash="linear-gradient(180deg, rgb(10 6 26 / 0.2) 0%, rgb(10 6 26 / 0.7) 100%)" />}>
      <div className="md:px-10">
        <h1 className="font-serif text-[44px] leading-none font-bold md:text-[64px]">Fortnox</h1>
        <p className="mt-3 text-[17px] text-white/85">A read-only copy of the bookkeeping, refreshed every night at 03:00.</p>
        {error && <Alert variant="destructive" className="mt-4"><AlertDescription>Fortnox error: {error}</AlertDescription></Alert>}
        <div className="mt-6"><FinanceTabs active="/fortnox" dark /></div>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-[1fr_480px] md:items-start md:px-10">
        <section className="glass flex flex-col gap-4 rounded-[32px] p-6 md:p-8">
          <div className="flex items-center gap-3">
            <Dot tone={status === 'connected' ? 'teal' : status === 'needs_reauth' ? 'sun' : 'grey'} />
            <h2 className="font-serif text-[32px] font-bold">{status === 'connected' ? 'Connected' : status === 'needs_reauth' ? 'Needs reconnecting' : 'Not connected'}</h2>
          </div>
          <p className="text-[15px] text-white/85">
            {status === 'connected' && <>Connected{connectedBy ? ` by ${connectedBy.name}` : ''}{connection?.connectedAt ? ` on ${day(connection.connectedAt)}` : ''}.{connection?.lastRefreshedAt ? ` Access was renewed ${when(connection.lastRefreshedAt)}.` : ''}</>}
            {status === 'needs_reauth' && <>Fortnox stopped accepting our access. Last error: {connection?.lastRefreshError ?? 'unknown'}. The budget still works; actual costs are frozen until you reconnect.</>}
            {status === 'disconnected' && <>Connect Fortnox to see what was actually spent next to the budget. You’ll sign in on Fortnox’s own page.</>}
          </p>
          <div className="flex flex-wrap gap-2">
            {status === 'connected' && <form action={runFirstImportAction}><Button type="submit" variant="outline">Run first import</Button></form>}
            <form action={connectAction}><Button type="submit" variant={status === 'connected' ? 'outline' : 'default'}>{status === 'disconnected' ? 'Connect Fortnox' : 'Reconnect'}</Button></form>
            {status === 'connected' && <form action={disconnectAction} className="sm:ml-auto"><Button type="submit" variant="outline">Disconnect</Button></form>}
          </div>
          {syncState.length > 0 && (
            <div className="mt-2 border-t border-white/15 pt-4">
              <h3 className="mb-2 text-xs font-semibold tracking-[0.08em] text-white/70 uppercase">Last full sync</h3>
              <ul className="flex flex-col">
                {syncState.map((s) => (
                  <li key={s.topic} className="flex justify-between py-1.5 text-[15px]">
                    <span>{TOPICS[s.topic] ?? s.topic}</span>
                    <span className="text-white/80 tabular">{s.lastFullSyncAt ? when(s.lastFullSyncAt) : 'Never'}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="glass flex flex-col gap-3 rounded-[32px] p-6 md:p-7">
          <h2 className="text-xs font-semibold tracking-[0.08em] text-white/70 uppercase">When something’s off</h2>
          <div className="flex flex-col gap-2 rounded-[22px] border border-white/15 bg-white/5 p-5">
            <p className="flex items-center gap-2.5 text-lg font-semibold"><Dot tone="sun" /> Needs reconnecting</p>
            <p className="text-sm text-white/80">Fortnox stops accepting our access now and then (an expired token, a changed password). The budget keeps working; actual costs stay frozen until someone reconnects.</p>
          </div>
          <div className="flex flex-col gap-2 rounded-[22px] border border-white/15 bg-white/5 p-5">
            <p className="flex items-center gap-2.5 text-lg font-semibold"><Dot tone="grey" /> Not connected</p>
            <p className="text-sm text-white/80">Nothing is read from Fortnox. Connect to see what was actually spent next to the budget.</p>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
