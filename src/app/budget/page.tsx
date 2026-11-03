import { inArray } from 'drizzle-orm';
import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { Backdrop } from '@/components/backdrop';
import { ConfirmForm } from '@/components/confirm-form';
import { FinanceTabs } from '@/components/finance-tabs';
import { Pill } from '@/components/pill';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getDb, schema } from '@/db';
import type { AnnualBudget, BudgetAmount, BudgetLineKind, ProjectGroup } from '@/db/schema';
import { computeBudgetTotals, listBudgetAmounts, listVersions, parseFiscalYear } from '@/lib/budgets/service';
import { oreToSek } from '@/lib/money';
import { listProjectGroups } from '@/lib/project-groups/service';
import { requireTreasurer } from '@/lib/session';
import { cn } from 'cn';
import { addLineAction, approveAction, deleteLineAction, startDraftAction, updateLineAction } from './actions';

export const dynamic = 'force-dynamic';

const KINDS: { kind: BudgetLineKind; label: string; add: string }[] = [
  { kind: 'cost', label: 'Costs', add: 'Add a cost line' },
  { kind: 'income', label: 'Income', add: 'Add an income line' },
  { kind: 'allocation', label: 'Allocation', add: 'Add an allocation' },
];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const kr = (ore: number) => `${oreToSek(ore).toLocaleString('sv-SE')} kr`;
const shortDate = (d: Date) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/Stockholm' }).format(d);
const label = 'text-xs font-semibold tracking-[0.08em] text-ink-soft uppercase';
const select = 'h-12 w-full rounded-full border border-input bg-field px-4 text-base';

function Tile({ title, value, note, tone }: { title: string; value: string; note: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="glass flex flex-col gap-1 rounded-[28px] p-5">
      <span className={label}>{title}</span>
      <span className={cn('font-serif text-[24px] font-bold tabular', tone === 'good' && 'text-good-ink', tone === 'bad' && 'text-[#6e1f17]')}>{value}</span>
      <span className="text-sm text-ink-soft">{note}</span>
    </div>
  );
}

function LineForm({ line, kind, groups, annualBudgetId, fiscalYear, cancelHref }: {
  line?: BudgetAmount; kind: BudgetLineKind; groups: ProjectGroup[]; annualBudgetId: string; fiscalYear: number; cancelHref: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-[24px] bg-white/80 p-3 shadow-[0_4px_24px_rgb(0_0_0/0.06)]">
      <form id={line ? `line-${line.id}` : 'line-new'} action={line ? updateLineAction : addLineAction} className="grid gap-2 md:grid-cols-[1.6fr_1.3fr_1fr_1fr]">
        {line && <input type="hidden" name="id" value={line.id} />}
        <input type="hidden" name="annualBudgetId" value={annualBudgetId} />
        <input type="hidden" name="fiscalYear" value={fiscalYear} />
        <input type="hidden" name="kind" value={kind} />
        <Input name="description" defaultValue={line?.description} placeholder="Description" aria-label="Description" required autoFocus />
        <select name="projectGroupId" defaultValue={line?.projectGroupId ?? ''} aria-label="Project group" className={select}>
          <option value="">No group</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <select name="month" defaultValue={line?.month ?? ''} aria-label="Month" className={select}>
          <option value="">All year</option>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <Input name="amountKr" type="number" step="0.01" defaultValue={line ? oreToSek(line.amountSek) : ''} placeholder="Amount" aria-label="Amount (kr)" required className="text-right tabular" />
      </form>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {line && (
          <form action={deleteLineAction} className="mr-auto md:mr-0">
            <input type="hidden" name="id" value={line.id} />
            <input type="hidden" name="fiscalYear" value={fiscalYear} />
            <input type="hidden" name="kind" value={kind} />
            <button type="submit" className="px-3 py-3 text-[15px] text-[#b4231a]">Remove line</button>
          </form>
        )}
        <Button variant="outline" nativeButton={false} render={<Link href={cancelHref} />}>Cancel</Button>
        <Button type="submit" form={line ? `line-${line.id}` : 'line-new'}>{line ? 'Save line' : 'Add line'}</Button>
      </div>
    </div>
  );
}

export default async function BudgetPage({ searchParams }: {
  searchParams: Promise<{ year?: string; error?: string; imported?: string; groupsCreated?: string; kind?: string; edit?: string; add?: string; version?: string }>;
}) {
  const treasurer = await requireTreasurer();
  const db = await getDb();
  const { year, error, imported, groupsCreated, kind: kindRaw, edit, add, version } = await searchParams;
  const fiscalYear = parseFiscalYear(year);
  const kind: BudgetLineKind = kindRaw === 'income' || kindRaw === 'allocation' ? kindRaw : 'cost';

  // Reading this page never creates or mutates a budget — getOrCreateDraft is only ever called
  // from an explicit action (startDraftAction below, or the CSV import), never from a GET.
  const groups = await listProjectGroups(db);
  const versions = await listVersions(db, fiscalYear);
  const newest = versions[0] ?? null; // draft or approved, never superseded
  // An earlier version can be opened read-only from the versions list.
  const current: AnnualBudget | null = versions.find((v) => v.id === version) ?? newest;
  const editable = current?.status === 'draft';
  const lines = current ? await listBudgetAmounts(db, current.id) : [];
  const totals = computeBudgetTotals(lines);
  const count = (k: BudgetLineKind) => lines.filter((l) => l.kind === k).length;
  const shown = lines.filter((l) => l.kind === kind);
  const shownTotal = shown.reduce((sum, l) => sum + l.amountSek, 0);
  const groupName = (id: string | null) => groups.find((g) => g.id === id)?.name ?? null;
  const approvers = new Map((await (async () => {
    const ids = versions.map((v) => v.approvedByUserId).filter((x): x is string => !!x);
    return ids.length ? db.select({ id: schema.user.id, name: schema.user.name, nickname: schema.user.nickname }).from(schema.user).where(inArray(schema.user.id, ids)) : [];
  })()).map((u) => [u.id, u.id === treasurer.id ? 'you' : u.nickname || u.name]));

  const costByGroup = [...lines.filter((l) => l.kind === 'cost').reduce((m, l) => {
    const name = groupName(l.projectGroupId) ?? 'No group';
    return m.set(name, (m.get(name) ?? 0) + l.amountSek);
  }, new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const maxGroup = Math.max(1, ...costByGroup.map(([, v]) => v));

  const base = (extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({ year: String(fiscalYear), ...(kind !== 'cost' ? { kind } : {}), ...(current && current.id !== newest?.id ? { version: current.id } : {}), ...extra });
    return `/budget?${p.toString()}`;
  };
  const subtitle = !current
    ? `No budget for ${fiscalYear} yet.`
    : current.status === 'draft'
      ? `Version ${current.version}, a draft. Nothing is final until it’s approved.`
      : current.status === 'approved'
        ? `Version ${current.version}, approved ${current.approvedAt ? shortDate(current.approvedAt) : ''}.`
        : `Version ${current.version}, an earlier version (read-only).`;

  return (
    <AppShell user={treasurer} backdrop={<Backdrop photo="square" blur={12} wash="rgb(246 244 238 / 0.5)" />}>
      <div className="flex flex-wrap items-start gap-4 md:px-10">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <h1 className="font-serif text-[36px] leading-none font-bold md:text-[64px]">Budget {fiscalYear}</h1>
            <Link href={`/budget?year=${fiscalYear - 1}`} aria-label="Previous year" className="glass flex size-11 items-center justify-center rounded-full text-lg">‹</Link>
            <Link href={`/budget?year=${fiscalYear + 1}`} aria-label="Next year" className="glass flex size-11 items-center justify-center rounded-full text-lg">›</Link>
          </div>
          <p className="mt-3 text-[17px] text-ink-soft">{subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-3 md:mt-3">
          <Button variant="outline" size="lg" nativeButton={false} render={<Link href="/budget/import" />}>Import CSV</Button>
          {editable && current ? (
            <ConfirmForm action={approveAction} fields={{ annualBudgetId: current.id, fiscalYear: String(fiscalYear) }}
              trigger="Approve this budget" title={`Approve the ${fiscalYear} budget?`}
              body={`Version ${current.version} becomes the approved budget and can't be edited any more. To change it later you start a new version.`}
              confirm="Approve" />
          ) : current?.id === newest?.id || !current ? (
            <form action={startDraftAction}>
              <input type="hidden" name="fiscalYear" value={fiscalYear} />
              <Button type="submit" size="lg">{current ? 'Revise this budget' : `Start the ${fiscalYear} budget`}</Button>
            </form>
          ) : null}
        </div>
      </div>
      {error && <Alert variant="destructive" className="mt-4 md:mx-10"><AlertDescription>{error}</AlertDescription></Alert>}
      {imported && <Alert className="mt-4 md:mx-10"><AlertDescription>Imported {imported} lines, created {groupsCreated} new project groups.</AlertDescription></Alert>}

      <div className="mt-6 md:px-10"><FinanceTabs active="/budget" /></div>

      {current && (
        <div className="mt-6 grid gap-6 md:grid-cols-[1fr_380px] md:items-start md:px-10">
          <div className="flex min-w-0 flex-col gap-6">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile title="Costs" value={kr(totals.totalCostSek)} note={`${count('cost')} lines`} />
              <Tile title="Income" value={kr(totals.totalIncomeSek)} note={`${count('income')} lines`} />
              <Tile title="Result" value={`${totals.resultSek > 0 ? '+' : ''}${kr(totals.resultSek)}`} note="Income minus costs" tone={totals.resultSek >= 0 ? 'good' : 'bad'} />
              <Tile title="Allocation" value={kr(totals.totalAllocationSek)} note={`${count('allocation')} ${count('allocation') === 1 ? 'fund' : 'funds'}`} />
            </div>

            <section className="glass flex flex-col gap-2 rounded-[32px] p-4 md:p-5">
              <div className="flex flex-wrap items-center gap-3">
                <nav aria-label="Kind" className="inline-flex rounded-full bg-forest/8 p-1">
                  {KINDS.map((k) => (
                    <Link key={k.kind} href={`/budget?${new URLSearchParams({ year: String(fiscalYear), ...(k.kind !== 'cost' ? { kind: k.kind } : {}), ...(current.id !== newest?.id ? { version: current.id } : {}) })}`}
                      aria-current={kind === k.kind ? 'page' : undefined}
                      className={cn('flex h-10 items-center gap-1.5 rounded-full px-4 text-[15px] font-semibold', kind === k.kind ? 'bg-white shadow-sm' : 'text-ink')}>
                      {k.label} <span className="font-normal text-ink-soft">{count(k.kind)}</span>
                    </Link>
                  ))}
                </nav>
                <span className="ml-auto text-sm text-ink-soft tabular">{kr(shownTotal)} in {shown.length} {shown.length === 1 ? 'line' : 'lines'}</span>
              </div>
              <div className="hidden grid-cols-[1.6fr_1.3fr_1fr_1fr] gap-2 px-4 pt-3 pb-1 md:grid">
                {['Description', 'Project group', 'Month', 'Amount'].map((h, i) => <span key={h} className={cn(label, i === 3 && 'text-right')}>{h}</span>)}
              </div>
              {shown.map((line) => line.id === edit && editable ? (
                <LineForm key={line.id} line={line} kind={kind} groups={groups} annualBudgetId={current.id} fiscalYear={fiscalYear} cancelHref={base()} />
              ) : (
                <Link key={line.id} href={editable ? base({ edit: line.id }) : '#'} aria-disabled={!editable}
                  className={cn('grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 rounded-[18px] px-4 py-3 md:grid-cols-[1.6fr_1.3fr_1fr_1fr]', editable && 'hover:bg-white/60', !editable && 'pointer-events-none')}>
                  <span className="text-base">{line.description || '—'}</span>
                  <span className="order-3 md:order-none">{groupName(line.projectGroupId) && <Pill>{groupName(line.projectGroupId)}</Pill>}</span>
                  <span className="order-4 text-sm text-ink-soft md:order-none md:text-base">{line.month ? MONTHS[line.month - 1] : 'All year'}</span>
                  <span className="order-2 text-right font-semibold tabular md:order-none">{kr(line.amountSek)}</span>
                </Link>
              ))}
              {add && editable && <LineForm kind={kind} groups={groups} annualBudgetId={current.id} fiscalYear={fiscalYear} cancelHref={base()} />}
              {shown.length === 0 && !add && <p className="px-4 py-3 text-ink-soft">No {KINDS.find((k) => k.kind === kind)!.label.toLowerCase()} lines yet.</p>}
              {editable && !add && (
                <Link href={base({ add: '1' })} className="self-start px-4 py-3 text-[15px] font-semibold">+ {KINDS.find((k) => k.kind === kind)!.add}</Link>
              )}
            </section>
          </div>

          <div className="flex flex-col gap-6">
            <section className="glass flex flex-col gap-3 rounded-[32px] p-6 md:p-7">
              <h2 className={label}>Costs by project group</h2>
              {costByGroup.length === 0 && <p className="text-sm text-ink-soft">No costs yet.</p>}
              {costByGroup.map(([name, sum]) => (
                <div key={name} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline gap-2"><span className="flex-1 text-[15px] font-semibold">{name}</span><span className="text-sm tabular">{kr(sum)}</span></div>
                  <div className="h-2 rounded-full bg-forest/10"><div className="h-2 rounded-full bg-forest" style={{ width: `${(sum / maxGroup) * 100}%` }} /></div>
                </div>
              ))}
            </section>
            <section className="glass flex flex-col gap-1 rounded-[32px] p-6 md:p-7">
              <h2 className={cn(label, 'mb-2')}>Versions of {fiscalYear}</h2>
              {versions.map((v) => (
                <Link key={v.id} href={v.id === newest?.id ? `/budget?year=${fiscalYear}` : `/budget?year=${fiscalYear}&version=${v.id}`}
                  aria-current={v.id === current.id ? 'page' : undefined}
                  className={cn('flex items-center gap-3 rounded-[18px] px-3 py-3', v.id === current.id ? 'bg-white/60' : 'hover:bg-white/40')}>
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-semibold">Version {v.version}</p>
                    <p className="text-sm text-ink-soft">
                      {v.status === 'draft' ? `Started ${shortDate(v.createdAt)}` : v.approvedAt ? `Approved ${shortDate(v.approvedAt)}${v.approvedByUserId ? ` by ${approvers.get(v.approvedByUserId) ?? 'someone'}` : ''}` : `Started ${shortDate(v.createdAt)}`}
                    </p>
                  </div>
                  <Pill tone={v.status === 'draft' ? 'sun' : v.status === 'approved' ? 'good' : 'muted'}>{v.status === 'draft' ? 'Draft' : v.status === 'approved' ? 'Approved' : 'Earlier'}</Pill>
                </Link>
              ))}
              <p className="mt-2 text-sm text-ink-soft">Approving keeps earlier versions, read-only.</p>
            </section>
          </div>
        </div>
      )}
    </AppShell>
  );
}
