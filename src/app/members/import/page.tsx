import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { requireMemberAdmin } from '@/lib/session';
import { importMembersAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function ImportMembersPage({ searchParams }: { searchParams: Promise<{ results?: string }> }) {
  const admin = await requireMemberAdmin();
  const { results } = await searchParams;
  const parsed = results ? (JSON.parse(results) as { email: string; status: string; message?: string }[]) : null;

  return (
    <AppShell user={admin}>
      <h1 className="mb-4 text-xl font-semibold">Import members</h1>
      <Card className="max-w-lg">
        <CardHeader><CardTitle>Paste CSV (name,email,membershipExpiresAt)</CardTitle></CardHeader>
        <CardContent>
          <form action={importMembersAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="csv">CSV</Label>
              <Textarea id="csv" name="csv" rows={10} placeholder={'name,email,membershipExpiresAt\nViktor,viktor@example.org,2027-01-01'} />
            </div>
            <Button type="submit">Import</Button>
          </form>
        </CardContent>
      </Card>
      {parsed && (
        <Card className="mt-4 max-w-lg">
          <CardHeader><CardTitle>Results</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {parsed.map((r, i) => (
                <li key={i}>{r.email} — {r.status}{r.message ? `: ${r.message}` : ''}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </AppShell>
  );
}
