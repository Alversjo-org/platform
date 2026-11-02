import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { Role, RoleRequest } from '@/db/schema';
import { logDecision } from '@/lib/decision-log';
import { SELF_REQUESTABLE_ROLES } from './labels';

export class RoleNotSelfRequestableError extends Error {
  constructor(role: Role) {
    super(`${role} cannot be self-requested`);
    this.name = 'RoleNotSelfRequestableError';
  }
}

export class RequestNotPendingError extends Error {
  constructor(requestId: string) {
    super(`Role request ${requestId} is not pending`);
    this.name = 'RequestNotPendingError';
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

export type PendingRoleRequest = RoleRequest & { userEmail: string; userName: string | null };

export async function listPendingRoleRequests(db: Db): Promise<PendingRoleRequest[]> {
  const rows = await db
    .select({
      id: schema.roleRequest.id,
      userId: schema.roleRequest.userId,
      role: schema.roleRequest.role,
      status: schema.roleRequest.status,
      requestedAt: schema.roleRequest.requestedAt,
      decidedByUserId: schema.roleRequest.decidedByUserId,
      decidedAt: schema.roleRequest.decidedAt,
      userEmail: schema.user.email,
      userName: schema.user.name,
    })
    .from(schema.roleRequest)
    .innerJoin(schema.user, eq(schema.user.id, schema.roleRequest.userId))
    .where(eq(schema.roleRequest.status, 'pending'));
  return rows;
}

export async function decideRoleRequest(db: Db, input: { actor: { id: string }; requestId: string; approve: boolean }): Promise<void> {
  const [request] = await db.select().from(schema.roleRequest).where(eq(schema.roleRequest.id, input.requestId));
  if (!request || request.status !== 'pending') throw new RequestNotPendingError(input.requestId);

  if (input.approve) {
    await db
      .insert(schema.userRole)
      .values({ userId: request.userId, role: request.role, grantedByUserId: input.actor.id })
      .onConflictDoNothing();
  }

  await db
    .update(schema.roleRequest)
    .set({ status: input.approve ? 'approved' : 'denied', decidedByUserId: input.actor.id, decidedAt: new Date() })
    .where(eq(schema.roleRequest.id, input.requestId));

  await logDecision(db, {
    entity: 'role_request',
    entityId: input.requestId,
    actorUserId: input.actor.id,
    action: input.approve ? 'approve' : 'deny',
    diff: { role: request.role, userId: request.userId },
  });
}
