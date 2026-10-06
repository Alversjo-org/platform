import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { AppShell } from '@/components/app-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isActiveNow, needsPayment } from '@/lib/members/status';
import { requireUser } from '@/lib/session';
import { startCheckoutAction, updateProfileAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string; checkout?: string }> }) {
  const sessionUser = await requireUser();
  const { error, checkout } = await searchParams;
  const db = await getDb();
  const [member] = await db.select().from(schema.user).where(eq(schema.user.id, sessionUser.id));
  const active = isActiveNow(member);

  return (
    <AppShell user={sessionUser}>
      {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}
      {checkout === 'cancelled' && <Alert className="mb-4"><AlertDescription>Checkout was cancelled.</AlertDescription></Alert>}
      {checkout === 'success' && <Alert className="mb-4"><AlertDescription>Payment received — your membership will update shortly.</AlertDescription></Alert>}
      <Card className="mb-4 max-w-md">
        <CardHeader><CardTitle>Membership</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p>
            {active
              ? `Member until ${member.membershipExpiresAt!.toISOString().slice(0, 10)}`
              : member.membershipExpiresAt
                ? `Membership expired on ${member.membershipExpiresAt.toISOString().slice(0, 10)}`
                : 'You are not yet a member.'}
          </p>
          {needsPayment(member) && (
            <div className="flex flex-wrap gap-2">
              <form action={startCheckoutAction}>
                <input type="hidden" name="plan" value="yearly" />
                <Button type="submit">Pay yearly</Button>
              </form>
              <form action={startCheckoutAction}>
                <input type="hidden" name="plan" value="monthly" />
                <Button type="submit" variant="outline">Pay monthly</Button>
              </form>
              <form action={startCheckoutAction}>
                <input type="hidden" name="plan" value="one_time" />
                <Button type="submit" variant="outline">Pay one year (one-time)</Button>
              </form>
            </div>
          )}
        </CardContent>
      </Card>
      {active && (
        <Card className="max-w-md">
          <CardHeader><CardTitle>Your profile</CardTitle></CardHeader>
          <CardContent>
            <form action={updateProfileAction} className="space-y-4">
              <div className="space-y-2"><Label htmlFor="name">Name</Label><Input id="name" name="name" defaultValue={member.name} /></div>
              <div className="space-y-2"><Label htmlFor="nickname">Nickname</Label><Input id="nickname" name="nickname" defaultValue={member.nickname ?? ''} /></div>
              <div className="space-y-2"><Label htmlFor="phoneNumber">Phone number</Label><Input id="phoneNumber" name="phoneNumber" type="tel" placeholder="+46701234567" defaultValue={member.phoneNumber ?? ''} /></div>
              <div className="space-y-2"><Label htmlFor="discordHandle">Discord handle</Label><Input id="discordHandle" name="discordHandle" defaultValue={member.discordHandle ?? ''} /></div>
              <Button type="submit">Save</Button>
            </form>
          </CardContent>
        </Card>
      )}
    </AppShell>
  );
}
