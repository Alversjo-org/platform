import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getDb } from '@/db';
import { getRenewalMessage } from '@/lib/members/renewal-message';
import { requireMemberAdmin } from '@/lib/session';
import { updateRenewalMessageAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function RenewalMessageSettingsPage() {
  const admin = await requireMemberAdmin();
  const message = await getRenewalMessage(await getDb());
  return (
    <AppShell user={admin}>
      <h1 className="mb-4 text-xl font-semibold">Renewal message</h1>
      <Card className="max-w-lg">
        <CardHeader><CardTitle>Default renewal ask</CardTitle></CardHeader>
        <CardContent>
          <form action={updateRenewalMessageAction} className="space-y-4">
            <div className="space-y-2"><Label htmlFor="subject">Subject</Label><Input id="subject" name="subject" defaultValue={message.subject} /></div>
            <div className="space-y-2"><Label htmlFor="body">Body</Label><Textarea id="body" name="body" rows={8} defaultValue={message.body} /></div>
            <p className="text-sm text-muted-foreground">Use {'{name}'} and {'{expiresAt}'} as placeholders.</p>
            <Button type="submit">Save</Button>
          </form>
        </CardContent>
      </Card>
    </AppShell>
  );
}
