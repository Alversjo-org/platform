import Link from 'next/link';
import { getDb } from '@/db';
import { AppShell } from '@/components/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { listMembers } from '@/lib/members/service';
import { requireMemberAdmin } from '@/lib/session';
import { syncFromStripeAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ synced?: string; created?: string; matched?: string; error?: string }>;
}) {
  const admin = await requireMemberAdmin();
  const members = await listMembers(await getDb());
  const { synced, created, matched, error } = await searchParams;
  return (
    <AppShell user={admin}>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Members</h1>
        <div className="flex items-center gap-4">
          <Link href="/members/import" className="text-sm underline">Import CSV</Link>
          <Link href="/members/settings" className="text-sm underline">Renewal message</Link>
          <form action={syncFromStripeAction}>
            <Button type="submit" variant="outline" size="sm">Sync from Stripe</Button>
          </form>
        </div>
      </div>
      {synced !== undefined && (
        <p className="mb-4 text-sm text-muted-foreground">
          Stripe sync: {created ?? 0} created, {matched ?? 0} matched, {error ?? 0} errored.
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Phone</TableHead>
            <TableHead>Discord</TableHead><TableHead>Membership</TableHead><TableHead>Last contacted</TableHead><TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((m) => (
            <TableRow key={m.id}>
              <TableCell><Link href={`/members/${m.id}`} className="underline">{m.name || m.nickname || '—'}</Link></TableCell>
              <TableCell>{m.email}</TableCell>
              <TableCell>{m.phoneNumber ?? '—'}</TableCell>
              <TableCell>{m.discordHandle ?? '—'}</TableCell>
              <TableCell>
                <Badge variant={m.isActiveMember ? 'default' : 'secondary'}>{m.isActiveMember ? 'active' : 'inactive'}</Badge>
                {m.membershipExpiresAt && <span className="ml-2 text-muted-foreground text-sm">until {m.membershipExpiresAt.toISOString().slice(0, 10)}</span>}
              </TableCell>
              <TableCell>{m.lastContactedAt ? m.lastContactedAt.toISOString().slice(0, 10) : '—'}</TableCell>
              <TableCell className="text-right"><Link href={`/members/${m.id}`} className="underline">Edit</Link></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </AppShell>
  );
}
