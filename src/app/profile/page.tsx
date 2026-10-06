import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { AppShell } from '@/components/app-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requireUser } from '@/lib/session';
import { removeAvatarAction, updateProfileAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sessionUser = await requireUser();
  const { error } = await searchParams;
  const db = await getDb();
  const [member] = await db.select().from(schema.user).where(eq(schema.user.id, sessionUser.id));

  return (
    <AppShell user={sessionUser}>
      {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}
      <Card className="max-w-md">
        <CardHeader><CardTitle>Edit profile</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-4">
            <Avatar image={member.image ?? null} name={member.name} email={member.email} className="size-16 text-lg" />
            {member.image && (
              <form action={removeAvatarAction}>
                <Button type="submit" variant="outline" size="sm">Remove photo</Button>
              </form>
            )}
          </div>
          <form action={updateProfileAction} className="space-y-4">
            <div className="space-y-2"><Label htmlFor="avatar">Photo</Label><Input id="avatar" name="avatar" type="file" accept="image/*" /></div>
            <div className="space-y-2"><Label htmlFor="name">Name</Label><Input id="name" name="name" defaultValue={member.name} /></div>
            <div className="space-y-2"><Label htmlFor="nickname">Nickname</Label><Input id="nickname" name="nickname" defaultValue={member.nickname ?? ''} /></div>
            <div className="space-y-2"><Label htmlFor="phoneNumber">Phone number</Label><Input id="phoneNumber" name="phoneNumber" type="tel" placeholder="+46701234567" defaultValue={member.phoneNumber ?? ''} /></div>
            <div className="space-y-2"><Label htmlFor="discordHandle">Discord handle</Label><Input id="discordHandle" name="discordHandle" defaultValue={member.discordHandle ?? ''} /></div>
            <Button type="submit">Save</Button>
          </form>
        </CardContent>
      </Card>
    </AppShell>
  );
}
