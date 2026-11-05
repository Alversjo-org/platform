import { AppShell } from '@/components/app-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getDb } from '@/db';
import { listMembers } from '@/lib/members/service';
import { ADMIN_ONLY_ROLES, ROLE_LABELS } from '@/lib/roles/labels';
import { listPendingRoleRequests } from '@/lib/roles/request-service';
import { GRANTABLE_ROLES, groupRolesByUserId, listUserRoles } from '@/lib/roles/service';
import { hasAnyRole, requireRoleAdmin } from '@/lib/session';
import { decideRoleRequestAction } from './actions';
import { RolesTable } from './roles-table';

export const dynamic = 'force-dynamic';

export default async function RolesPage({ searchParams }: { searchParams: Promise<{ error?: string; q?: string }> }) {
  const actor = await requireRoleAdmin();
  const { error, q } = await searchParams;
  const db = await getDb();
  const members = await listMembers(db);
  const rolesByUserId = groupRolesByUserId(await listUserRoles(db));
  const canChangeAdminRoles = hasAnyRole(actor, ['admin']);
  const pendingRequests = await listPendingRoleRequests(db);

  return (
    <AppShell user={actor} className="md:px-20">
      {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}
      <h1 className="mb-4 font-serif text-[36px] leading-tight font-bold md:text-[52px]">Roles</h1>
      {pendingRequests.length > 0 && (
        <>
          <h2 className="mb-2 text-lg font-medium">Pending requests</h2>
          <Table className="mb-6">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Requested</TableHead><TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendingRequests.map((req) => (
                <TableRow key={req.id}>
                  <TableCell>{req.userName || '—'}</TableCell>
                  <TableCell>{req.userEmail}</TableCell>
                  <TableCell>{ROLE_LABELS[req.role]}</TableCell>
                  <TableCell>{req.requestedAt.toLocaleDateString()}</TableCell>
                  <TableCell className="flex gap-2">
                    <form action={decideRoleRequestAction}>
                      <input type="hidden" name="requestId" value={req.id} />
                      <input type="hidden" name="approve" value="true" />
                      <Button type="submit" size="sm" variant="outline">Approve</Button>
                    </form>
                    <form action={decideRoleRequestAction}>
                      <input type="hidden" name="requestId" value={req.id} />
                      <input type="hidden" name="approve" value="false" />
                      <Button type="submit" size="sm" variant="ghost">Deny</Button>
                    </form>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
      <RolesTable
        members={members.map((m) => ({ id: m.id, name: m.name, nickname: m.nickname, email: m.email }))}
        rolesByUserId={Object.fromEntries(rolesByUserId)}
        roles={GRANTABLE_ROLES.map((role) => ({ role, label: ROLE_LABELS[role], adminOnly: ADMIN_ONLY_ROLES.includes(role) }))}
        canChangeAdminRoles={canChangeAdminRoles}
        initialQuery={q ?? ''}
      />
    </AppShell>
  );
}
