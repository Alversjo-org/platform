import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { ExpenseStatusBadge } from '@/components/expenses/status-badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getDb } from '@/db';
import { getBankAccountSummary } from '@/lib/expenses/bank-account-service';
import { maskedLabel } from '@/lib/expenses/bank-details';
import { formatSek } from '@/lib/expenses/format';
import { listExpensesForUser } from '@/lib/expenses/service';
import { isTreasurer, requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function ExpensesPage() {
  const user = await requireUser();
  const db = await getDb();
  const [expenses, account] = await Promise.all([listExpensesForUser(db, user.id), getBankAccountSummary(db, user.id)]);

  return (
    <AppShell user={user} className="md:px-20">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-serif text-[36px] leading-tight font-bold md:text-[52px]">My outlays</h1>
        <div className="flex flex-wrap gap-2">
          {isTreasurer(user) && <Button variant="outline" nativeButton={false} render={<Link href="/expenses/review" />}>Review outlays</Button>}
          <Button nativeButton={false} render={<Link href="/expenses/new" />}>New outlay</Button>
        </div>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Paid for something for Alversjö yourself (utlägg)? Send in the receipt here; once the treasurer approves it, it’s paid back to your bank account.
      </p>
      {account ? (
        <p className="mb-4 text-sm">Paid to: {maskedLabel(account.kind, account.last4)} · <Link href="/profile/bank" className="underline">change</Link></p>
      ) : (
        <Alert className="mb-4"><AlertDescription>Add your <Link href="/profile/bank" className="underline">payout bank account</Link> so approved outlays can be paid.</AlertDescription></Alert>
      )}
      {expenses.length === 0 ? (
        <p className="text-sm text-muted-foreground">No outlays yet.</p>
      ) : (
        <Table>
          <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>What</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {expenses.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="whitespace-nowrap">{e.purchaseDate}</TableCell>
                <TableCell><Link href={`/expenses/${e.id}`} className="underline">{e.description}</Link></TableCell>
                <TableCell className="text-right whitespace-nowrap">{formatSek(e.totalOre)}</TableCell>
                <TableCell><ExpenseStatusBadge status={e.status} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </AppShell>
  );
}
