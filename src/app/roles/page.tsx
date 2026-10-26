import { AppShell } from '@/components/app-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getDb } from '@/db';
import type { Role } from '@/db/schema';
import { listMembers } from '@/lib/members/service';
import { GRANTABLE_ROLES, groupRolesByUserId, listUserRoles } from '@/lib/roles/service';
import { hasAnyRole, requireRoleAdmin } from '@/lib/session';
import { setUserRoleAction } from './actions';

export const dynamic = 'force-dynamic';

const ADMIN_ONLY_ROLES: Role[] = ['admin', 'role-admin'];

export default async function RolesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const actor = await requireRoleAdmin();
  const { error } = await searchParams;
  const db = await getDb();
  const members = await listMembers(db);
  const rolesByUserId = groupRolesByUserId(await listUserRoles(db));
  const canChangeAdminRoles = hasAnyRole(actor, ['admin']);

  return (
    <AppShell user={actor}>
      {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}
      <h1 className="mb-4 text-xl font-semibold">Roles</h1>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead><TableHead>Email</TableHead>
            {GRANTABLE_ROLES.map((role) => <TableHead key={role}>{role}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((m) => {
            const memberRoles = rolesByUserId.get(m.id) ?? [];
            return (
              <TableRow key={m.id}>
                <TableCell>{m.name || m.nickname || '—'}</TableCell>
                <TableCell>{m.email}</TableCell>
                {GRANTABLE_ROLES.map((role) => {
                  const held = memberRoles.includes(role);
                  if (ADMIN_ONLY_ROLES.includes(role) && !canChangeAdminRoles) {
                    return <TableCell key={role}>{held ? 'yes' : '—'}</TableCell>;
                  }
                  return (
                    <TableCell key={role}>
                      <form action={setUserRoleAction}>
                        <input type="hidden" name="userId" value={m.id} />
                        <input type="hidden" name="role" value={role} />
                        <input type="hidden" name="grant" value={held ? 'false' : 'true'} />
                        <Button type="submit" size="sm" variant={held ? 'ghost' : 'outline'}>{held ? 'Revoke' : 'Grant'}</Button>
                      </form>
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </AppShell>
  );
}
