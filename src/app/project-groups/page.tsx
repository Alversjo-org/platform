import { and, desc, eq, isNotNull } from 'drizzle-orm';
import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { Backdrop } from '@/components/backdrop';
import { FinanceTabs } from '@/components/finance-tabs';
import { Pill } from '@/components/pill';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getDb, schema } from '@/db';
import type { ProjectGroup } from '@/db/schema';
import { listBudgetAmounts, listVersions } from '@/lib/budgets/service';
import { oreToSek } from '@/lib/money';
import { listProjectGroups } from '@/lib/project-groups/service';
import { requireTreasurer } from '@/lib/session';
import { cn } from 'cn';
import { createProjectGroupAction, updateProjectGroupAction } from './actions';

export const dynamic = 'force-dynamic';

const label = 'text-xs font-semibold tracking-[0.08em] text-ink-soft uppercase';
const select = 'h-12 w-full rounded-full border border-input bg-field px-4 text-base';
const cols = 'grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 md:grid-cols-[2fr_1fr_1fr_1fr_auto]';

/** Groups in tree order: each parent followed by its children, with their depth. */
function tree(groups: ProjectGroup[]): { group: ProjectGroup; depth: number }[] {
  const out: { group: ProjectGroup; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const g of groups.filter((x) => x.parentId === parentId).sort((a, b) => (a.costCentreCode ?? 'zz').localeCompare(b.costCentreCode ?? 'zz') || a.name.localeCompare(b.name))) {
      out.push({ group: g, depth });
      walk(g.id, depth + 1);
    }
  };
  walk(null, 0);
  // Anything whose parent is missing still shows, at the top level.
  for (const g of groups) if (!out.some((o) => o.group.id === g.id)) out.push({ group: g, depth: 0 });
  return out;
}

export default async function ProjectGroupsPage({ searchParams }: { searchParams: Promise<{ error?: string; edit?: string }> }) {
  const treasurer = await requireTreasurer();
  const db = await getDb();
  const groups = await listProjectGroups(db);
  const { error, edit } = await searchParams;
  const costCentres = await db.select().from(schema.fxCostCentre).where(eq(schema.fxCostCentre.active, true));

  const eventRows = await db.select({ groupId: schema.project.projectGroupId }).from(schema.project)
    .where(and(eq(schema.project.kind, 'event'), isNotNull(schema.project.projectGroupId)));
  const events = (id: string) => eventRows.filter((r) => r.groupId === id).length;

  // Budget column: the newest version of the latest year that has a budget.
  const [latest] = await db.select({ year: schema.annualBudget.fiscalYear }).from(schema.annualBudget).orderBy(desc(schema.annualBudget.fiscalYear)).limit(1);
  const version = latest ? (await listVersions(db, latest.year))[0] : undefined;
  const lines = version ? await listBudgetAmounts(db, version.id) : [];
  const budget = (id: string) => lines.filter((l) => l.projectGroupId === id && l.kind !== 'income').reduce((s, l) => s + l.amountSek, 0);

  const costCentreField = (defaultValue: string | null, id?: string) => costCentres.length > 0 ? (
    <select id={id} name="costCentreCode" defaultValue={defaultValue ?? ''} className={select} aria-label="Cost centre">
      <option value="">No code</option>
      {costCentres.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
    </select>
  ) : (
    <Input id={id} name="costCentreCode" defaultValue={defaultValue ?? ''} placeholder="Fortnox cost centre code" aria-label="Cost centre" />
  );

  return (
    <AppShell user={treasurer} backdrop={<Backdrop photo="square" blur={12} wash="rgb(246 244 238 / 0.5)" />}>
      <div className="md:px-10">
        <h1 className="font-serif text-[40px] leading-none font-bold md:text-[64px]">Project groups</h1>
        <p className="mt-3 text-[17px] text-ink-soft">How events and budget lines add up. Codes are Fortnox cost centres.</p>
        {error && <Alert variant="destructive" className="mt-4"><AlertDescription>{error}</AlertDescription></Alert>}
        <div className="mt-6"><FinanceTabs active="/project-groups" /></div>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-[1fr_380px] md:items-start md:px-10">
        <section className="glass flex flex-col rounded-[32px] p-3 md:p-4">
          <div className={cn(cols, 'hidden px-4 pt-2 pb-2 md:grid')}>
            <span className={label}>Name</span><span className={label}>Cost centre</span><span className={label}>Events</span>
            <span className={cn(label, 'text-right')}>{latest ? `Budget ${latest.year}` : 'Budget'}</span><span className="w-12" />
          </div>
          {groups.length === 0 && <p className="p-4 text-ink-soft">No project groups yet.</p>}
          {tree(groups).map(({ group: g, depth }) => g.id === edit ? (
            <form key={g.id} action={updateProjectGroupAction} className="my-1 flex flex-col gap-3 rounded-[24px] bg-white/80 p-3 shadow-[0_4px_24px_rgb(0_0_0/0.06)]">
              <input type="hidden" name="id" value={g.id} />
              <div className="grid gap-2 md:grid-cols-3">
                <Input name="name" defaultValue={g.name} placeholder="Name" aria-label="Name" required autoFocus />
                {costCentreField(g.costCentreCode)}
                <select name="parentId" defaultValue={g.parentId ?? ''} className={select} aria-label="Inside">
                  <option value="">No parent</option>
                  {groups.filter((p) => p.id !== g.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" nativeButton={false} render={<Link href="/project-groups" />}>Cancel</Button>
                <Button type="submit">Save</Button>
              </div>
            </form>
          ) : (
            <div key={g.id} className={cn(cols, 'rounded-[18px] px-4 py-2.5 hover:bg-white/60')}>
              <span className={cn('text-base', depth === 0 ? 'font-semibold' : 'text-ink')} style={{ paddingLeft: depth * 28 }}>
                {depth > 0 && <span aria-hidden className="mr-2 text-ink-soft">↳</span>}{g.name}
              </span>
              <span className="hidden md:block">{g.costCentreCode ? <Pill>CC {g.costCentreCode}</Pill> : <span className="text-sm text-ink-soft">No code</span>}</span>
              <span className="hidden text-ink-soft md:block">{events(g.id) ? `${events(g.id)} ${events(g.id) === 1 ? 'event' : 'events'}` : '—'}</span>
              <span className="text-right tabular">{budget(g.id) ? `${oreToSek(budget(g.id)).toLocaleString('sv-SE')} kr` : '—'}</span>
              <Link href={`/project-groups?edit=${g.id}`} className="hidden w-12 text-right text-[15px] font-semibold md:block">Edit</Link>
            </div>
          ))}
        </section>

        <section className="glass flex flex-col gap-4 rounded-[32px] p-6 md:p-7">
          <h2 className="font-serif text-[26px] font-bold">Add a project group</h2>
          <form action={createProjectGroupAction} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2"><Label htmlFor="name">Name</Label><Input id="name" name="name" placeholder="e.g. Forest garden" required /></div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="costCentreCode">Cost centre</Label>
              {costCentreField(null, 'costCentreCode')}
              <p className="text-xs text-ink-soft">Leave empty for a fund, like Rainy Day Fund.</p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="parentId">Inside</Label>
              <select id="parentId" name="parentId" defaultValue="" className={select}>
                <option value="">No parent</option>
                {groups.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <Button type="submit" size="lg">Add project group</Button>
          </form>
        </section>
      </div>
    </AppShell>
  );
}
