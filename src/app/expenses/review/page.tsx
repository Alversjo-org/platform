import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { ExpenseStatusBadge } from '@/components/expenses/status-badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getDb } from '@/db';
import { formatSek } from '@/lib/expenses/format';
import { listExpensesByStatus, type ExpenseListItem } from '@/lib/expenses/service';
import { requireTreasurer } from '@/lib/session';

export const dynamic = 'force-dynamic';

function List({ items, empty }: { items: ExpenseListItem[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Ref</TableHead><TableHead>Member</TableHead><TableHead>What</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
      <TableBody>
        {items.map((e) => (
          <TableRow key={e.id}>
            <TableCell className="whitespace-nowrap"><Link href={`/expenses/${e.id}`} className="underline">{e.reference}</Link></TableCell>
            <TableCell>{e.memberName || e.memberEmail}</TableCell>
            <TableCell>{e.description}{e.bookingError && <span className="block text-xs text-destructive">Fortnox: {e.bookingError}</span>}</TableCell>
            <TableCell className="text-right whitespace-nowrap">{formatSek(e.totalOre)}</TableCell>
            <TableCell><ExpenseStatusBadge status={e.status} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default async function ReviewExpensesPage() {
  const treasurer = await requireTreasurer();
  const db = await getDb();
  const [submitted, approved] = await Promise.all([listExpensesByStatus(db, ['submitted']), listExpensesByStatus(db, ['approved'])]);
  const needsBooking = approved.filter((e) => e.voucherNumber === null || e.bookingError);

  return (
    <AppShell user={treasurer} className="md:px-20">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-serif text-[36px] leading-tight font-bold md:text-[52px]">Review outlays</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" nativeButton={false} render={<Link href="/expenses/settings" />}>Settings</Button>
          <Button nativeButton={false} render={<Link href="/expenses/payments" />}>Payments</Button>
        </div>
      </div>
      <h2 className="mb-2 font-medium">Waiting for approval ({submitted.length})</h2>
      <List items={submitted} empty="Nothing to approve." />
      <h2 className="mt-6 mb-2 font-medium">Approved but not (fully) booked in Fortnox ({needsBooking.length})</h2>
      <List items={needsBooking} empty="Everything approved is booked." />
    </AppShell>
  );
}
