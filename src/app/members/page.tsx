import Link from 'next/link';
import { getDb } from '@/db';
import { AppShell } from '@/components/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { resolveDialogTarget } from '@/lib/members/dialog-target';
import { listMembers } from '@/lib/members/service';
import { groupRolesByUserId, listUserRoles } from '@/lib/roles/service';
import { hasAnyRole, requireMemberAdmin } from '@/lib/session';
import { syncFromStripeAction } from './actions';
import { MemberDialogs, type EditableMember } from './member-dialogs';

export const dynamic = 'force-dynamic';

type Status = 'active' | 'inactive' | 'all';
const STATUS_TABS: { value: Status; label: string }[] = [
  { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'all', label: 'All' },
];

function toEditableMember(m: {
  id: string; name: string; nickname: string | null; email: string; phoneNumber: string | null; discordHandle: string | null;
  isActiveMember: boolean; canCreateEvents: boolean; membershipExpiresAt: Date | null; lastContactedAt: Date | null;
  contactNotes: string | null;
}): EditableMember {
  return {
    id: m.id, name: m.name, nickname: m.nickname, email: m.email, phoneNumber: m.phoneNumber, discordHandle: m.discordHandle,
    isActiveMember: m.isActiveMember, canCreateEvents: m.canCreateEvents, membershipExpiresAt: m.membershipExpiresAt,
    lastContactedAt: m.lastContactedAt, contactNotes: m.contactNotes,
  };
}

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
  const activeCount = allMembers.filter((m) => m.isActiveMember).length;
  const counts: Record<Status, number> = { active: activeCount, inactive: allMembers.length - activeCount, all: allMembers.length };

  // Resolved from the unfiltered list, not `members` - a dialog must stay reachable for a
  // member the current status tab doesn't happen to show (e.g. editing someone from Inactive).
  const dialogTarget = resolveDialogTarget(allMembers, { edit, roles });

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
            {tab.label} ({counts[tab.value]})
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
                <Link href={`/members?edit=${encodeURIComponent(m.id)}`} className="underline">{m.name || m.nickname || '—'}</Link>
              </TableCell>
              <TableCell>{m.email}</TableCell>
              <TableCell>
                <Badge variant={m.isActiveMember ? 'default' : 'secondary'}>{m.isActiveMember ? 'active' : 'inactive'}</Badge>
                {m.membershipExpiresAt && <span className="ml-2 text-muted-foreground text-sm">until {m.membershipExpiresAt.toISOString().slice(0, 10)}</span>}
              </TableCell>
              <TableCell className="text-right">
                {canManageRoles && <Link href={`/members?roles=${encodeURIComponent(m.id)}`} className="text-sm underline">Roles</Link>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {dialogTarget && (
        <MemberDialogs
          member={toEditableMember(dialogTarget)}
          memberRoles={rolesByUserId.get(dialogTarget.id) ?? []}
          canManageRoles={canManageRoles}
          canChangeAdminRoles={canChangeAdminRoles}
          openEdit={dialogTarget.id === edit}
          openRoles={dialogTarget.id === roles}
          error={error}
        />
      )}
    </AppShell>
  );
}
