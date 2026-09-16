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
import { requireAdmin } from '@/lib/session';
import { updateUserAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function UserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const admin = await requireAdmin();
  const db = await getDb();
  const [user] = await db.select().from(schema.user).where(eq(schema.user.id, id));
  if (!user) notFound();

  return (
    <AppShell user={admin}>
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <h1 className="mb-4 text-xl font-semibold">{user.email}</h1>
      <Card className="max-w-md">
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent>
          <form action={updateUserAction} className="space-y-4">
            <input type="hidden" name="id" value={user.id} />
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" defaultValue={user.name} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phoneNumber">Phone number</Label>
              <Input id="phoneNumber" name="phoneNumber" type="tel" placeholder="+46701234567" defaultValue={user.phoneNumber ?? ''} />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="isActiveMember" name="isActiveMember" defaultChecked={user.isActiveMember} />
              <Label htmlFor="isActiveMember">Active member</Label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="membershipExpiresAt">Membership expires</Label>
              <Input
                id="membershipExpiresAt"
                name="membershipExpiresAt"
                type="date"
                defaultValue={user.membershipExpiresAt ? user.membershipExpiresAt.toISOString().slice(0, 10) : ''}
              />
            </div>
            <Button type="submit">Save</Button>
          </form>
        </CardContent>
      </Card>
    </AppShell>
  );
}
