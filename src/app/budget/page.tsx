import { AppShell } from '@/components/app-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getDb } from '@/db';
import type { BudgetAmount, BudgetLineKind, ProjectGroup } from '@/db/schema';
import { computeBudgetTotals, getOrCreateDraft, listBudgetAmounts, listVersions } from '@/lib/budgets/service';
import { oreToSek } from '@/lib/money';
import { listProjectGroups } from '@/lib/project-groups/service';
import { requireTreasurer } from '@/lib/session';
import { addLineAction, approveAction, deleteLineAction, updateLineAction } from './actions';

export const dynamic = 'force-dynamic';

const SECTION_LABELS: Record<BudgetLineKind, string> = { cost: 'Costs', income: 'Income', allocation: 'Allocation' };

function LineSection({
  kind, lines, groups, annualBudgetId, fiscalYear, editable,
}: {
  kind: BudgetLineKind; lines: BudgetAmount[]; groups: ProjectGroup[]; annualBudgetId: string; fiscalYear: number; editable: boolean;
}) {
  const sectionLines = lines.filter((l) => l.kind === kind);
  return (
    <Card className="mb-6">
      <CardHeader><CardTitle>{SECTION_LABELS[kind]}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead><TableHead>Group</TableHead><TableHead>Month</TableHead><TableHead>Amount (kr)</TableHead>
              {editable && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sectionLines.map((line) => (
              <TableRow key={line.id}>
                {editable ? (
                  <>
                    <TableCell colSpan={4}>
                      <form action={updateLineAction} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="id" value={line.id} />
                        <input type="hidden" name="annualBudgetId" value={annualBudgetId} />
                        <input type="hidden" name="fiscalYear" value={fiscalYear} />
                        <input type="hidden" name="kind" value={kind} />
                        <Input name="description" defaultValue={line.description} placeholder="Description" className="w-40" />
                        <select name="projectGroupId" defaultValue={line.projectGroupId ?? ''} className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm">
                          <option value="">No group</option>
                          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                        </select>
                        <Input name="month" type="number" min={1} max={12} defaultValue={line.month ?? ''} placeholder="Month" className="w-20" />
                        <Input name="amountKr" type="number" step="0.01" defaultValue={oreToSek(line.amountSek)} className="w-28" />
                        <Button type="submit" size="sm">Save</Button>
                      </form>
                    </TableCell>
                    <TableCell>
                      <form action={deleteLineAction}>
                        <input type="hidden" name="id" value={line.id} />
                        <input type="hidden" name="fiscalYear" value={fiscalYear} />
                        <button type="submit" className="text-sm underline">Remove</button>
                      </form>
                    </TableCell>
                  </>
                ) : (
                  <>
                    <TableCell>{line.description}</TableCell>
                    <TableCell>{groups.find((g) => g.id === line.projectGroupId)?.name ?? '—'}</TableCell>
                    <TableCell>{line.month ?? '—'}</TableCell>
                    <TableCell>{oreToSek(line.amountSek).toLocaleString('sv-SE')}</TableCell>
                  </>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {editable && (
          <form action={addLineAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="annualBudgetId" value={annualBudgetId} />
            <input type="hidden" name="fiscalYear" value={fiscalYear} />
            <input type="hidden" name="kind" value={kind} />
            <Input name="description" placeholder="Description" className="w-40" required />
            <select name="projectGroupId" defaultValue="" className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm">
              <option value="">No group</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <Input name="month" type="number" min={1} max={12} placeholder="Month" className="w-20" />
            <Input name="amountKr" type="number" step="0.01" placeholder="Amount (kr)" className="w-28" required />
            <Button type="submit" size="sm">Add</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ year?: string; error?: string }> }) {
  const treasurer = await requireTreasurer();
  const db = await getDb();
  const { year, error } = await searchParams;
  const fiscalYear = year ? Number(year) : new Date().getFullYear();

  const draft = await getOrCreateDraft(db, fiscalYear);
  const lines = await listBudgetAmounts(db, draft.id);
  const totals = computeBudgetTotals(lines);
  const groups = await listProjectGroups(db);
  const versions = await listVersions(db, fiscalYear);
  const priorVersions = versions.filter((v) => v.id !== draft.id);

  return (
    <AppShell user={treasurer}>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Budget {fiscalYear}</h1>
        <a href="/budget/import" className="text-sm underline">Import CSV</a>
      </div>
      {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}

      <Card className="mb-6">
        <CardHeader><CardTitle>Summary (draft v{draft.version})</CardTitle></CardHeader>
        <CardContent>
          <p>Total cost: {oreToSek(totals.totalCostSek).toLocaleString('sv-SE')} kr</p>
          <p>Total income: {oreToSek(totals.totalIncomeSek).toLocaleString('sv-SE')} kr</p>
          <p>Result: {oreToSek(totals.resultSek).toLocaleString('sv-SE')} kr</p>
          <p>Total allocation: {oreToSek(totals.totalAllocationSek).toLocaleString('sv-SE')} kr</p>
          <form action={approveAction} className="mt-4">
            <input type="hidden" name="annualBudgetId" value={draft.id} />
            <input type="hidden" name="fiscalYear" value={fiscalYear} />
            <Button type="submit">Approve this budget</Button>
          </form>
        </CardContent>
      </Card>

      <LineSection kind="cost" lines={lines} groups={groups} annualBudgetId={draft.id} fiscalYear={fiscalYear} editable />
      <LineSection kind="income" lines={lines} groups={groups} annualBudgetId={draft.id} fiscalYear={fiscalYear} editable />
      <LineSection kind="allocation" lines={lines} groups={groups} annualBudgetId={draft.id} fiscalYear={fiscalYear} editable />

      {await Promise.all(priorVersions.map(async (v) => {
        const versionLines = await listBudgetAmounts(db, v.id);
        return (
          <Card key={v.id} className="mb-6">
            <CardHeader><CardTitle>Version {v.version} ({v.status})</CardTitle></CardHeader>
            <CardContent>
              {(['cost', 'income', 'allocation'] as const).map((kind) => (
                <LineSection key={kind} kind={kind} lines={versionLines} groups={groups} annualBudgetId={v.id} fiscalYear={fiscalYear} editable={false} />
              ))}
            </CardContent>
          </Card>
        );
      }))}
    </AppShell>
  );
}
