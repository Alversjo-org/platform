import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { getDb, schema } from '@/db';
import { AppShell } from '@/components/app-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getRenewalMessage, renderMessage } from '@/lib/members/renewal-message';
import { requireMemberAdmin } from '@/lib/session';
import { sendRenewalAskAction, updateMemberAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function MemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const admin = await requireMemberAdmin();
  const db = await getDb();
  const [member] = await db.select().from(schema.user).where(eq(schema.user.id, id));
  if (!member) notFound();
  const defaultMessage = await getRenewalMessage(db);
  const prefilled = {
    subject: renderMessage(defaultMessage.subject, { name: member.name, expiresAt: member.membershipExpiresAt }),
    body: renderMessage(defaultMessage.body, { name: member.name, expiresAt: member.membershipExpiresAt }),
  };

  return (
    <AppShell user={admin}>
      {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}
      <h1 className="mb-4 text-xl font-semibold">{member.email}</h1>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent>
            <form action={updateMemberAction} className="space-y-4">
              <input type="hidden" name="id" value={member.id} />
              <div className="space-y-2"><Label htmlFor="name">Name</Label><Input id="name" name="name" defaultValue={member.name} /></div>
              <div className="space-y-2"><Label htmlFor="nickname">Nickname</Label><Input id="nickname" name="nickname" defaultValue={member.nickname ?? ''} /></div>
              <div className="space-y-2"><Label htmlFor="phoneNumber">Phone number</Label><Input id="phoneNumber" name="phoneNumber" type="tel" placeholder="+46701234567" defaultValue={member.phoneNumber ?? ''} /></div>
              <div className="space-y-2"><Label htmlFor="discordHandle">Discord handle</Label><Input id="discordHandle" name="discordHandle" defaultValue={member.discordHandle ?? ''} /></div>
              <div className="flex items-center gap-2"><Checkbox id="isActiveMember" name="isActiveMember" defaultChecked={member.isActiveMember} /><Label htmlFor="isActiveMember">Active member</Label></div>
              <div className="space-y-2">
                <Label htmlFor="membershipExpiresAt">Membership expires</Label>
                <Input id="membershipExpiresAt" name="membershipExpiresAt" type="date" defaultValue={member.membershipExpiresAt ? member.membershipExpiresAt.toISOString().slice(0, 10) : ''} />
              </div>
              <div className="space-y-2"><Label htmlFor="contactNotes">Notes</Label><Textarea id="contactNotes" name="contactNotes" defaultValue={member.contactNotes ?? ''} /></div>
              <Button type="submit">Save</Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Send renewal ask</CardTitle></CardHeader>
          <CardContent>
            <form action={sendRenewalAskAction} className="space-y-4">
              <input type="hidden" name="id" value={member.id} />
              <div className="space-y-2"><Label htmlFor="subject">Subject</Label><Input id="subject" name="subject" defaultValue={prefilled.subject} /></div>
              <div className="space-y-2"><Label htmlFor="body">Message</Label><Textarea id="body" name="body" rows={8} defaultValue={prefilled.body} /></div>
              <p className="text-sm text-muted-foreground">
                {member.lastContactedAt ? `Last contacted ${member.lastContactedAt.toISOString().slice(0, 10)}` : 'Never contacted'}
              </p>
              <Button type="submit">Send</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
