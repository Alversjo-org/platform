import { and, asc, inArray } from 'drizzle-orm';
import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { ExpenseForm } from '@/components/expenses/expense-form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb, schema } from '@/db';
import { isReceiptReaderEnabled } from '@/lib/expenses/ocr';
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function NewExpensePage() {
  const user = await requireUser();
  const db = await getDb();
  const projects = await db.select({ id: schema.project.id, title: schema.project.title }).from(schema.project)
    .where(and(inArray(schema.project.status, ['draft', 'published'])))
    .orderBy(asc(schema.project.title));
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });

  return (
    <AppShell user={user} className="md:px-20">
      <p className="mb-2 text-sm"><Link href="/expenses" className="underline">← My outlays</Link></p>
      <Card className="max-w-xl">
        <CardHeader><CardTitle>New outlay</CardTitle></CardHeader>
        <CardContent>
          <ExpenseForm projects={projects} readerEnabled={isReceiptReaderEnabled()} today={today} />
        </CardContent>
      </Card>
    </AppShell>
  );
}
