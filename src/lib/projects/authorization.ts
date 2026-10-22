import { and, eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import { isMemberAdmin, type SessionUser } from '@/lib/session';

export class NotAuthorizedError extends Error {
  constructor(action: string) { super(`Not authorized to ${action}`); this.name = 'NotAuthorizedError'; }
}

export async function getEventRole(db: Db, projectId: string, user: SessionUser): Promise<'lead' | 'cocreator' | 'override' | null> {
  if (isMemberAdmin(user)) return 'override';
  const [row] = await db.select().from(schema.projectMember)
    .where(and(eq(schema.projectMember.projectId, projectId), eq(schema.projectMember.userId, user.id)));
  return row?.role ?? null;
}

export async function assertEventPermission(
  db: Db,
  projectId: string,
  user: SessionUser,
  permission: 'editDetails' | 'manage',
): Promise<void> {
  const role = await getEventRole(db, projectId, user);
  const allowed = role === 'override' || role === 'lead' || (role === 'cocreator' && permission === 'editDetails');
  if (!allowed) throw new NotAuthorizedError(permission);
}
