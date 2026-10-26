import Link from 'next/link';
import { getDb } from '@/db';
import { AppShell } from '@/components/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { listMembers } from '@/lib/members/service';
import { groupRolesByUserId, listUserRoles } from '@/lib/roles/service';
import { hasAnyRole, requireMemberAdmin } from '@/lib/session';
import { syncFromStripeAction } from './actions';
import { MemberRowDialogs } from './member-row-dialogs';

export const dynamic = 'force-dynamic';

type Status = 'active' | 'inactive' | 'all';
const STATUS_TABS: { value: Status; label: string }[] = [
  { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'all', label: 'All' },
];

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{
    synced?: string; created?: string; matched?: string; error?: string;
    status?: string; edit?: string; roles?: string;
  }>;
}) {
  const admin = await requireMemberAdmin();
  const db = await getDb();
  const allMembers = await listMembers(db);
  const rolesByUserId = groupRolesByUserId(await listUserRoles(db));
  const canManageRoles = hasAnyRole(admin, ['admin', 'role-admin']);
  const canChangeAdminRoles = hasAnyRole(admin, ['admin']);
  const { synced, created, matched, error, edit, roles, status: statusRaw } = await searchParams;
  const status: Status = statusRaw === 'inactive' || statusRaw === 'all' ? statusRaw : 'active';
  const members = allMembers.filter((m) =>
    status === 'all' ? true : status === 'active' ? m.isActiveMember : !m.isActiveMember);

  return (
    <AppShell user={admin}>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Members</h1>
        <div className="flex items-center gap-4">
          <Link href="/members/import" className="text-sm underline">Import CSV</Link>
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
      <div className="mb-4 flex gap-2">
        {STATUS_TABS.map((tab) => (
          <Button key={tab.value} render={<Link href={`/members?status=${tab.value}`} />}
            variant={status === tab.value ? 'default' : 'outline'} size="sm">
            {tab.label}
          </Button>
        ))}
      </div>
      <Table>
        <TableHeader>
          <TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Membership</TableHead><TableHead /></TableRow>
        </TableHeader>
        <TableBody>
          {members.map((m) => (
            <TableRow key={m.id}>
              <TableCell>
                <MemberRowDialogs
                  member={m}
                  memberRoles={rolesByUserId.get(m.id) ?? []}
                  canManageRoles={canManageRoles}
                  canChangeAdminRoles={canChangeAdminRoles}
                  openEdit={edit === m.id}
                  openRoles={roles === m.id}
                  error={edit === m.id ? error : undefined}
                />
              </TableCell>
              <TableCell>{m.email}</TableCell>
              <TableCell>
                <Badge variant={m.isActiveMember ? 'default' : 'secondary'}>{m.isActiveMember ? 'active' : 'inactive'}</Badge>
                {m.membershipExpiresAt && <span className="ml-2 text-muted-foreground text-sm">until {m.membershipExpiresAt.toISOString().slice(0, 10)}</span>}
              </TableCell>
              <TableCell />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </AppShell>
  );
}
