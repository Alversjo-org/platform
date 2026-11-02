import type { Role } from '@/db/schema';

// Lives here (not in service.ts) so client components can import it without pulling in
// service.ts's server-only dependencies (DB client, session helpers).
export const GRANTABLE_ROLES: Role[] = ['member-admin', 'mapper', 'role-admin', 'admin', 'treasurer', 'wiki-editor'];
export const ADMIN_ONLY_ROLES: Role[] = ['admin', 'role-admin'];

// Roles a member can request for themselves (see src/lib/roles/request-service.ts) rather
// than only being granted top-down by an admin/role-admin.
export const SELF_REQUESTABLE_ROLES: Role[] = ['wiki-editor'];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Superadmin',
  'role-admin': 'Role-Manager',
  'member-admin': 'Member-Manager',
  mapper: 'Mapper',
  treasurer: 'Treasurer',
  'wiki-editor': 'Wiki editor',
};
