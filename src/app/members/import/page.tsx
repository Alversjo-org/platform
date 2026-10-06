import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { requireMemberAdmin } from '@/lib/session';
import { importMembersAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function ImportMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; skipped?: string; error?: string; errorEmail?: string | string[] }>;
}) {
  const admin = await requireMemberAdmin();
  const { created, skipped, error, errorEmail } = await searchParams;
  const hasSummary = created !== undefined || skipped !== undefined || error !== undefined;
  const errorEmails = errorEmail === undefined ? [] : Array.isArray(errorEmail) ? errorEmail : [errorEmail];

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
      {hasSummary && (
        <Card className="mt-4 max-w-lg">
          <CardHeader><CardTitle>Results</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm">
              {created ?? 0} created, {skipped ?? 0} skipped, {error ?? 0} errored.
            </p>
            {errorEmails.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm">
                {errorEmails.map((email, i) => (
                  <li key={i}>{email} — error</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </AppShell>
  );
}
