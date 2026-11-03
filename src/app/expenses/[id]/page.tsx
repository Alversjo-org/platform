import { asc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { ExpenseStatusBadge } from '@/components/expenses/status-badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getDb, schema } from '@/db';
import { getBankAccountSummary } from '@/lib/expenses/bank-account-service';
import { maskedLabel } from '@/lib/expenses/bank-details';
import { formatSek } from '@/lib/expenses/format';
import { defaultCostCentre, getExpense } from '@/lib/expenses/service';
import { getExpenseSettings } from '@/lib/expenses/settings';
import { isTreasurer, requireUser } from '@/lib/session';
import { approveExpenseAction, bookExpenseAction, rejectExpenseAction, withdrawExpenseAction } from '../actions';

export const dynamic = 'force-dynamic';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

export default async function ExpensePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; submitted?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { error, submitted } = await searchParams;
  const db = await getDb();
  const e = await getExpense(db, id);
  if (!e) notFound();
  const treasurer = isTreasurer(user);
  if (e.userId !== user.id && !treasurer) redirect('/expenses');

  const [account, settings, ccDefault, accounts, costCentres, fxProjects] = await Promise.all([
    getBankAccountSummary(db, e.userId),
    treasurer ? getExpenseSettings(db) : null,
    treasurer ? defaultCostCentre(db, e.projectId) : null,
    treasurer ? db.select({ number: schema.fxAccount.number, name: schema.fxAccount.name }).from(schema.fxAccount).where(eq(schema.fxAccount.active, true)).orderBy(asc(schema.fxAccount.number)) : [],
    treasurer ? db.select({ code: schema.fxCostCentre.code, name: schema.fxCostCentre.name }).from(schema.fxCostCentre).where(eq(schema.fxCostCentre.active, true)).orderBy(asc(schema.fxCostCentre.code)) : [],
    treasurer ? db.select({ code: schema.fxProject.code, name: schema.fxProject.name }).from(schema.fxProject).where(eq(schema.fxProject.active, true)).orderBy(asc(schema.fxProject.code)) : [],
  ]);
  const uniqueAccounts = [...new Map(accounts.map((a) => [a.number, a])).values()];
  const booked = e.voucherNumber !== null;
  const allAttached = e.receipts.every((r) => r.connectedAt !== null);

  return (
    <AppShell user={user}>
      <p className="mb-2 text-sm">
        <Link href="/expenses" className="underline">← My outlays</Link>
        {treasurer && <> · <Link href="/expenses/review" className="underline">Review outlays</Link></>}
      </p>
      {submitted && <Alert className="mb-4 max-w-2xl"><AlertDescription>Sent to the treasurer. You’ll get an email when it’s approved and paid.</AlertDescription></Alert>}
      {error && <Alert variant="destructive" className="mb-4 max-w-2xl"><AlertDescription>{error}</AlertDescription></Alert>}

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">{e.description} <ExpenseStatusBadge status={e.status} /></CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="space-y-1">
            <Row label="Reference">{e.reference}</Row>
            <Row label="Member">{e.memberName || e.memberEmail}</Row>
            <Row label="Amount">{formatSek(e.totalOre)} <span className="text-muted-foreground">(VAT {formatSek(e.vatOre)})</span></Row>
            <Row label="Purchase date">{e.purchaseDate}</Row>
            {e.merchant && <Row label="Shop">{e.merchant}</Row>}
            <Row label="Project">{e.projectTitle ?? '—'}</Row>
            {e.note && <Row label="Note">{e.note}</Row>}
            <Row label="Paid to">{account ? `${maskedLabel(account.kind, account.last4)} (${account.holderName})` : <span className="text-destructive">No bank account yet</span>}</Row>
            {e.status === 'rejected' && <Row label="Why not">{e.rejectionReason}</Row>}
            {booked && <Row label="Fortnox">Voucher {e.voucherSeries}{e.voucherNumber}{allAttached ? ', receipts attached' : ', receipts not attached yet'}</Row>}
            {e.bookingError && treasurer && <Row label="Booking error"><span className="text-destructive">{e.bookingError}</span></Row>}
          </dl>

          <div>
            <p className="mb-1 text-sm font-medium">Receipts</p>
            <ul className="list-inside list-disc text-sm">
              {e.receipts.map((r) => (
                <li key={r.id}><a href={`/expenses/receipts/${r.id}`} target="_blank" rel="noreferrer" className="underline">{r.fileName}</a> <span className="text-muted-foreground">({Math.ceil(r.sizeBytes / 1024)} kB)</span></li>
              ))}
            </ul>
          </div>

          {e.status === 'submitted' && e.userId === user.id && (
            <form action={withdrawExpenseAction}>
              <input type="hidden" name="id" value={e.id} />
              <Button type="submit" variant="outline" size="sm">Withdraw</Button>
            </form>
          )}
        </CardContent>
      </Card>

      {treasurer && settings && e.status === 'submitted' && (
        <div className="mt-4 grid max-w-2xl gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Approve and book</CardTitle></CardHeader>
            <CardContent>
              <form action={approveExpenseAction} className="space-y-3">
                <input type="hidden" name="id" value={e.id} />
                <div className="space-y-1">
                  <Label htmlFor="costAccount">Cost account</Label>
                  <Input id="costAccount" name="costAccount" required inputMode="numeric" list="accounts" defaultValue={settings.defaultCostAccount} />
                  <datalist id="accounts">{uniqueAccounts.map((a) => <option key={a.number} value={a.number}>{a.name}</option>)}</datalist>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="costCentreCode">Cost centre</Label>
                  <select id="costCentreCode" name="costCentreCode" defaultValue={ccDefault ?? ''} className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm">
                    <option value="">None</option>
                    {costCentres.map((c) => <option key={c.code} value={c.code}>{c.code} {c.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="fxProjectCode">Fortnox project</Label>
                  <select id="fxProjectCode" name="fxProjectCode" defaultValue="" className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm">
                    <option value="">None</option>
                    {fxProjects.map((p) => <option key={p.code} value={p.code}>{p.code} {p.name}</option>)}
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="bookVat" defaultChecked={e.vatOre > 0} /> Reclaim VAT ({formatSek(e.vatOre)} to {settings.vatAccount})
                </label>
                <p className="text-xs text-muted-foreground">
                  Books voucher series {settings.outlaySeries} on the purchase date, crediting {settings.liabilityAccount}, and attaches the receipts.
                </p>
                <Button type="submit">Approve</Button>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Not approved</CardTitle></CardHeader>
            <CardContent>
              <form action={rejectExpenseAction} className="space-y-3">
                <input type="hidden" name="id" value={e.id} />
                <Label htmlFor="reason">Reason (sent to the member)</Label>
                <Textarea id="reason" name="reason" rows={3} required placeholder="The receipt is cut off — please send a photo of the whole receipt." />
                <Button type="submit" variant="destructive">Don’t approve</Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {treasurer && e.status !== 'submitted' && e.status !== 'rejected' && (!booked || !allAttached) && (
        <form action={bookExpenseAction} className="mt-4">
          <input type="hidden" name="id" value={e.id} />
          <Button type="submit" variant="outline">{booked ? 'Attach receipts in Fortnox' : 'Book in Fortnox'}</Button>
        </form>
      )}
    </AppShell>
  );
}
