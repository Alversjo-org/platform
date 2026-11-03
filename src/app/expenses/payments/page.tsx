import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getDb } from '@/db';
import { formatSek } from '@/lib/expenses/format';
import { listPaymentBatches } from '@/lib/expenses/payments';
import { listPayable } from '@/lib/expenses/service';
import { getExpenseSettings } from '@/lib/expenses/settings';
import { requireTreasurer } from '@/lib/session';
import { bookPayoutAction, cancelBatchAction, createPaymentBatchAction, markBatchPaidAction } from '../actions';

export const dynamic = 'force-dynamic';

function nextBankDay(from: Date): string {
  const d = new Date(from);
  do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ error?: string; created?: string }> }) {
  const treasurer = await requireTreasurer();
  const { error, created } = await searchParams;
  const db = await getDb();
  const [payable, batches, settings] = await Promise.all([listPayable(db), listPaymentBatches(db), getExpenseSettings(db)]);
  const ready = payable.filter((p) => p.hasBankAccount);
  const waiting = payable.filter((p) => !p.hasBankAccount);
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
  const settingsMissing = !settings.debtorName || !settings.debtorOrgNumber || !settings.debtorIban;

  return (
    <AppShell user={treasurer}>
      <p className="mb-2 text-sm"><Link href="/expenses/review" className="underline">← Review outlays</Link></p>
      <h1 className="mb-4 text-xl font-semibold">Payments</h1>
      {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}
      {created && (
        <Alert className="mb-4"><AlertDescription>
          Payment file created. <a href={`/expenses/payments/${created}/file`} className="underline">Download it</a>, upload it in the bank’s
          file transfer (ISO 20022 / pain.001) and sign it there. When the bank has paid, mark it as paid below.
        </AlertDescription></Alert>
      )}
      {settingsMissing && (
        <Alert className="mb-4"><AlertDescription>Fill in the association’s bank account in the <Link href="/expenses/settings" className="underline">settings</Link> before creating a payment file.</AlertDescription></Alert>
      )}

      <Card className="mb-6">
        <CardHeader><CardTitle>Ready to pay</CardTitle></CardHeader>
        <CardContent>
          {ready.length === 0 ? <p className="text-sm text-muted-foreground">No approved, booked outlays waiting.</p> : (
            <form action={createPaymentBatchAction} className="space-y-3">
              <Table>
                <TableHeader><TableRow><TableHead /><TableHead>Ref</TableHead><TableHead>Member</TableHead><TableHead>What</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                <TableBody>
                  {ready.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell><input type="checkbox" name="expenseId" value={e.id} defaultChecked aria-label={`Pay ${e.reference}`} /></TableCell>
                      <TableCell><Link href={`/expenses/${e.id}`} className="underline">{e.reference}</Link></TableCell>
                      <TableCell>{e.memberName || e.memberEmail}</TableCell>
                      <TableCell>{e.description}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{formatSek(e.totalOre)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label htmlFor="executionDate">Payment date</Label>
                  <Input id="executionDate" name="executionDate" type="date" min={today} defaultValue={nextBankDay(new Date())} required />
                </div>
                <Button type="submit" disabled={settingsMissing}>Create payment file</Button>
              </div>
            </form>
          )}
          {waiting.length > 0 && (
            <p className="mt-3 text-sm text-muted-foreground">
              Waiting for the member to add a bank account: {waiting.map((w) => `${w.reference} (${w.memberName || w.memberEmail})`).join(', ')}
            </p>
          )}
        </CardContent>
      </Card>

      <h2 className="mb-2 font-medium">Payment files</h2>
      {batches.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : (
        <Table>
          <TableHeader><TableRow><TableHead>File</TableHead><TableHead>Pay date</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {batches.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="whitespace-nowrap"><a href={`/expenses/payments/${b.id}/file`} className="underline">{b.reference}.xml</a> <span className="text-muted-foreground">({b.count})</span></TableCell>
                <TableCell>{b.executionDate}</TableCell>
                <TableCell className="text-right whitespace-nowrap">{formatSek(b.totalOre)}</TableCell>
                <TableCell>
                  <Badge variant={b.status === 'paid' ? 'default' : b.status === 'cancelled' ? 'outline' : 'secondary'}>{b.status === 'exported' ? 'sent to bank' : b.status}</Badge>
                  {b.status === 'paid' && (b.voucherNumber !== null
                    ? <span className="block text-xs text-muted-foreground">Fortnox {b.voucherSeries}{b.voucherNumber}</span>
                    : <span className="block text-xs text-destructive">Not booked{b.bookingError ? `: ${b.bookingError}` : ''}</span>)}
                </TableCell>
                <TableCell>
                  {b.status === 'exported' && (
                    <div className="flex flex-wrap items-center gap-2">
                      <form action={markBatchPaidAction} className="flex items-center gap-2">
                        <input type="hidden" name="batchId" value={b.id} />
                        <Input name="paidDate" type="date" defaultValue={b.executionDate} className="h-8 w-36" aria-label="Date paid" />
                        <Button type="submit" size="sm">Mark paid</Button>
                      </form>
                      <form action={cancelBatchAction}>
                        <input type="hidden" name="batchId" value={b.id} />
                        <Button type="submit" size="sm" variant="ghost">Cancel</Button>
                      </form>
                    </div>
                  )}
                  {b.status === 'paid' && b.voucherNumber === null && (
                    <form action={bookPayoutAction}>
                      <input type="hidden" name="batchId" value={b.id} />
                      <Button type="submit" size="sm" variant="outline">Book in Fortnox</Button>
                    </form>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        Mark a file paid only after the bank has executed it (check the bank statement). That books series {settings.payoutSeries}: {settings.liabilityAccount} against {settings.bankLedgerAccount}.
        Cancel a file the bank rejected or that you won’t send; its outlays go back to “Ready to pay”.
      </p>
    </AppShell>
  );
}
