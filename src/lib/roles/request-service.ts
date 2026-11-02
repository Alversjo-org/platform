import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { Role, RoleRequest } from '@/db/schema';

const SELF_REQUESTABLE_ROLES: Role[] = ['wiki-editor'];

export class RoleNotSelfRequestableError extends Error {
  constructor(role: Role) {
    super(`${role} cannot be self-requested`);
    this.name = 'RoleNotSelfRequestableError';
  }
}

export async function requestRole(db: Db, input: { userId: string; role: Role }): Promise<RoleRequest> {
  if (!SELF_REQUESTABLE_ROLES.includes(input.role)) throw new RoleNotSelfRequestableError(input.role);

  const [existingGrant] = await db
    .select()
    .from(schema.userRole)
    .where(and(eq(schema.userRole.userId, input.userId), eq(schema.userRole.role, input.role)));
  if (existingGrant) {
    return {
      id: '',
      userId: input.userId,
      role: input.role,
      status: 'approved',
      requestedAt: existingGrant.createdAt,
      decidedByUserId: existingGrant.grantedByUserId,
      decidedAt: existingGrant.createdAt,
    };
  }

  const [existingPending] = await db
    .select()
    .from(schema.roleRequest)
    .where(and(eq(schema.roleRequest.userId, input.userId), eq(schema.roleRequest.role, input.role), eq(schema.roleRequest.status, 'pending')));
  if (existingPending) return existingPending;

  const [created] = await db
    .insert(schema.roleRequest)
    .values({ id: randomUUID(), userId: input.userId, role: input.role })
    .returning();
  return created;
}
