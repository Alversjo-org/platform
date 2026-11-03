import { AppShell } from '@/components/app-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { requireTreasurer } from '@/lib/session';
import { importBudgetCsvAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function ImportBudgetPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const treasurer = await requireTreasurer();
  const { error } = await searchParams;

  return (
    <AppShell user={treasurer} className="md:px-20">
      <h1 className="mb-4 font-serif text-[36px] leading-tight font-bold md:text-[52px]">Import budget</h1>
      {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}
      <Card className="max-w-lg">
        <CardHeader><CardTitle>Paste the budget CSV</CardTitle></CardHeader>
        <CardContent>
          <form action={importBudgetCsvAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="csv">CSV</Label>
              <Textarea id="csv" name="csv" rows={16} placeholder={'YEAR,2027\nCOSTS,\nElectricity,50000\nREVENUE,\nLand Memberships,330000'} />
            </div>
            <Button type="submit">Import</Button>
          </form>
        </CardContent>
      </Card>
    </AppShell>
  );
}
