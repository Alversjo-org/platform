import Link from 'next/link';
import { getDb } from '@/db';
import { AppShell } from '@/components/app-shell';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { listUsers } from '@/lib/users/service';
import { requireAdmin } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const admin = await requireAdmin();
  const users = await listUsers(await getDb());
  return (
    <AppShell user={admin}>
      <h1 className="mb-4 text-xl font-semibold">Users</h1>
      <Table>
        <TableHeader>
          <TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Phone</TableHead><TableHead>Membership</TableHead><TableHead /></TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => (
            <TableRow key={u.id}>
              <TableCell><Link href={`/users/${u.id}`} className="underline">{u.name || '—'}</Link></TableCell>
              <TableCell>{u.email}</TableCell>
              <TableCell>{u.phoneNumber ?? '—'}</TableCell>
              <TableCell>
                <Badge variant={u.isActiveMember ? 'default' : 'secondary'}>{u.isActiveMember ? 'active' : 'inactive'}</Badge>
                {u.membershipExpiresAt && <span className="ml-2 text-muted-foreground text-sm">until {u.membershipExpiresAt.toISOString().slice(0, 10)}</span>}
              </TableCell>
              <TableCell className="text-right"><Link href={`/users/${u.id}`} className="underline">Edit</Link></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </AppShell>
  );
}
