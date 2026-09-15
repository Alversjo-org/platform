import Link from 'next/link';
import { getDb } from '@/db';
import { AppShell } from '@/components/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { listBoxesFor } from '@/lib/boxes/access';
import { boxOpenUrl } from '@/lib/boxes/urls';
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function BoxesPage() {
  const user = await requireUser();
  const boxes = await listBoxesFor(await getDb(), user);
  return (
    <AppShell user={user}>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Boxes</h1>
        {user.role === 'admin' && <Button render={<Link href="/boxes/new" />}>New box</Button>}
      </div>
      {boxes.length === 0 ? (
        <p className="text-muted-foreground">No boxes shared with you yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow><TableHead>Name</TableHead><TableHead>Profile</TableHead><TableHead>Status</TableHead><TableHead /></TableRow>
          </TableHeader>
          <TableBody>
            {boxes.map((b) => (
              <TableRow key={b.id}>
                <TableCell><Link href={`/boxes/${b.id}`} className="underline">{b.name}</Link>{b.protected && <Badge variant="secondary" className="ml-2">protected</Badge>}</TableCell>
                <TableCell><Badge variant={b.profile === 'admin' ? 'default' : 'outline'}>{b.profile}</Badge></TableCell>
                <TableCell>{b.status}</TableCell>
                <TableCell className="text-right"><Button size="sm" render={<a href={boxOpenUrl(b.id)} />}>Open</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </AppShell>
  );
}
