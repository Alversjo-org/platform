import Link from 'next/link';
import { getDb } from '@/db';
import { AppShell } from '@/components/app-shell';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { listMembers } from '@/lib/members/service';
import { requireMemberAdmin } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function MembersPage() {
  const admin = await requireMemberAdmin();
  const members = await listMembers(await getDb());
  return (
    <AppShell user={admin}>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Members</h1>
        <div className="flex gap-4">
          <Link href="/members/import" className="text-sm underline">Import CSV</Link>
          <Link href="/members/settings" className="text-sm underline">Renewal message</Link>
        </div>
      </div>
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
