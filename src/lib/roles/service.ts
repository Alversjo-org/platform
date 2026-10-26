import { and, eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { Role, UserRole } from '@/db/schema';
import { logDecision } from '@/lib/decision-log';
import { ADMIN_ONLY_ROLES, GRANTABLE_ROLES } from '@/lib/roles/labels';
import { hasAnyRole } from '@/lib/session';

export { ADMIN_ONLY_ROLES, GRANTABLE_ROLES };

export class NotAuthorizedError extends Error {
  constructor() { super('Only an admin can change this role'); this.name = 'NotAuthorizedError'; }
}

export class UnknownRoleError extends Error {
  constructor(role: string) { super(`Unknown role: ${role}`); this.name = 'UnknownRoleError'; }
}

export async function setUserRole(
  db: Db,
  input: { actor: { id: string; roles: Role[] }; targetUserId: string; role: Role; grant: boolean },
): Promise<void> {
  if (!GRANTABLE_ROLES.includes(input.role)) throw new UnknownRoleError(input.role);
  if (!hasAnyRole(input.actor, ['admin', 'role-admin'])) throw new NotAuthorizedError();
  if (ADMIN_ONLY_ROLES.includes(input.role) && !hasAnyRole(input.actor, ['admin'])) {
    throw new NotAuthorizedError();
  }
  if (input.grant) {
    await db.insert(schema.userRole)
      .values({ userId: input.targetUserId, role: input.role, grantedByUserId: input.actor.id })
      .onConflictDoNothing();
  } else {
    await db.delete(schema.userRole).where(and(eq(schema.userRole.userId, input.targetUserId), eq(schema.userRole.role, input.role)));
  }
  await logDecision(db, {
    entity: 'user_role', entityId: input.targetUserId, actorUserId: input.actor.id,
    action: input.grant ? 'grant' : 'revoke', diff: { role: input.role },
  });
}

export function listUserRoles(db: Db): Promise<UserRole[]> {
  return db.select().from(schema.userRole);
}

export function groupRolesByUserId(rows: { userId: string; role: Role }[]): Map<string, Role[]> {
  const map = new Map<string, Role[]>();
  for (const row of rows) {
    const existing = map.get(row.userId);
    if (existing) existing.push(row.role);
    else map.set(row.userId, [row.role]);
  }
  return map;
}
