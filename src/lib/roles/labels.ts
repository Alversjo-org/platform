import type { Role } from '@/db/schema';

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Superadmin',
  'role-admin': 'Role-Manager',
  'member-admin': 'Member-Manager',
  mapper: 'Mapper',
};
