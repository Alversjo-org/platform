'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { filterMembers, rolesReturnTo } from '@/lib/members/filter';
import { setUserRoleAction } from './actions';

type Member = { id: string; name: string; nickname: string | null; email: string };
type RoleColumn = { role: string; label: string; adminOnly: boolean };

/**
 * The roles grid with a search box that narrows the rows as you type. The search text is
 * mirrored into the URL (without a server round-trip) and sent as `returnTo` with each
 * grant/revoke, so the list is still filtered after the action redirects back.
 */
export function RolesTable({ members, rolesByUserId, roles, canChangeAdminRoles, initialQuery }: {
  members: Member[];
  rolesByUserId: Record<string, string[]>;
  roles: RoleColumn[];
  canChangeAdminRoles: boolean;
  initialQuery: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const shown = filterMembers(members, query);

  const onChange = (value: string) => {
    setQuery(value);
    window.history.replaceState(null, '', rolesReturnTo(value));
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input type="search" role="search" aria-label="Search members" placeholder="Search by name, nickname or email"
          value={query} onChange={(e) => onChange(e.target.value)} autoComplete="off" className="max-w-md" />
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {query.trim() ? `${shown.length} of ${members.length} members` : `${members.length} members`}
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead><TableHead>Email</TableHead>
            {roles.map((r) => <TableHead key={r.role}>{r.label}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.length === 0 && (
            <TableRow><TableCell colSpan={roles.length + 2} className="text-muted-foreground">No one matches.</TableCell></TableRow>
          )}
          {shown.map((m) => {
            const memberRoles = rolesByUserId[m.id] ?? [];
            return (
              <TableRow key={m.id}>
                <TableCell>{m.name || m.nickname || '—'}</TableCell>
                <TableCell>{m.email}</TableCell>
                {roles.map(({ role, adminOnly }) => {
                  const held = memberRoles.includes(role);
                  if (adminOnly && !canChangeAdminRoles) {
                    return <TableCell key={role}>{held ? 'yes' : '—'}</TableCell>;
                  }
                  return (
                    <TableCell key={role}>
                      <form action={setUserRoleAction}>
                        <input type="hidden" name="userId" value={m.id} />
                        <input type="hidden" name="role" value={role} />
                        <input type="hidden" name="grant" value={held ? 'false' : 'true'} />
                        <input type="hidden" name="returnTo" value={rolesReturnTo(query)} />
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
    </>
  );
}
