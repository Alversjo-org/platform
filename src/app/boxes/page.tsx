import Link from 'next/link';
import { getDb } from '@/db';
import { AppShell } from '@/components/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { listBoxesFor } from '@/lib/boxes/access';
import { boxDeps } from '@/lib/boxes/deps';
import { liveStates, stateBadgeVariant } from '@/lib/boxes/live';
import { boxOpenUrl } from '@/lib/boxes/urls';
import { requireUser } from '@/lib/session';
import type { Box } from '@/db/schema';
import type { FlyMachineState } from '@/lib/fly';

export const dynamic = 'force-dynamic';

async function getLiveStates(boxes: Box[]): Promise<Map<string, FlyMachineState | 'unknown'>> {
  try {
    const deps = await boxDeps();
    return await liveStates(deps.fly, boxes);
  } catch {
    // No Fly client available (e.g. a dev box without FLY_API_TOKEN) — every box is unknown.
    return new Map(boxes.map((b) => [b.id, 'unknown' as const]));
  }
}

export default async function BoxesPage() {
  const user = await requireUser();
  const boxes = await listBoxesFor(await getDb(), user);
  const states = await getLiveStates(boxes);
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
            {boxes.map((b) => {
              const state = states.get(b.id) ?? 'unknown';
              return (
                <TableRow key={b.id}>
                  <TableCell><Link href={`/boxes/${b.id}`} className="underline">{b.name}</Link></TableCell>
                  <TableCell><Badge variant={b.profile === 'admin' ? 'default' : 'outline'}>{b.profile}</Badge></TableCell>
                  <TableCell><Badge variant={stateBadgeVariant(state)}>{state}</Badge></TableCell>
                  <TableCell className="text-right"><Button size="sm" render={<a href={boxOpenUrl(b.id)} />}>Open</Button></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </AppShell>
  );
}
