import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { getDb, schema } from '@/db';
import { AppShell } from '@/components/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { canAccessBox } from '@/lib/boxes/access';
import { boxOpenUrl } from '@/lib/boxes/urls';
import { requireUser } from '@/lib/session';
import { destroyBoxAction, revokeBoxAction, shareBoxAction, startBoxAction, stopBoxAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function BoxPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const db = await getDb();
  if (!(await canAccessBox(db, user, id))) notFound();
  const [box] = await db.select().from(schema.boxes).where(eq(schema.boxes.id, id));
  const members = await db
    .select({ userId: schema.user.id, email: schema.user.email })
    .from(schema.boxAccess)
    .innerJoin(schema.user, eq(schema.user.id, schema.boxAccess.userId))
    .where(eq(schema.boxAccess.boxId, id));
  const isAdmin = user.role === 'admin';

  return (
    <AppShell user={user}>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{box.name} {box.protected && <Badge variant="secondary">protected</Badge>}</h1>
        <Button render={<a href={boxOpenUrl(box.id)} />}>Open</Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Machine</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>Profile: <Badge variant="outline">{box.profile}</Badge></p>
            <p>Status: {box.status}</p>
            <p>Host: <code>{box.id}.{process.env.BOXES_DOMAIN ?? 'boxes.localhost'}</code></p>
            <p className="text-muted-foreground">Fly machine {box.flyMachineId ?? '—'}, volume {box.flyVolumeId ?? '—'}</p>
            {isAdmin && (
              <div className="flex gap-2">
                <form action={startBoxAction}><input type="hidden" name="id" value={box.id} /><Button size="sm" variant="outline">Start</Button></form>
                <form action={stopBoxAction}><input type="hidden" name="id" value={box.id} /><Button size="sm" variant="outline">Stop</Button></form>
                {!box.protected && (
                  <form action={destroyBoxAction}><input type="hidden" name="id" value={box.id} /><Button size="sm" variant="destructive">Destroy</Button></form>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Access</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <TableHeader><TableRow><TableHead>Email</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.userId}>
                    <TableCell>{m.email}</TableCell>
                    <TableCell className="text-right">
                      {isAdmin && m.userId !== box.ownerUserId && (
                        <form action={revokeBoxAction}><input type="hidden" name="id" value={box.id} /><input type="hidden" name="userId" value={m.userId} /><Button size="sm" variant="ghost">Revoke</Button></form>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {isAdmin && (
              <form action={shareBoxAction} className="flex items-end gap-2">
                <input type="hidden" name="id" value={box.id} />
                <div className="flex-1 space-y-2">
                  <Label htmlFor="email">Share with (must have logged in once)</Label>
                  <Input id="email" name="email" type="email" required />
                </div>
                <Button size="sm">Share</Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
