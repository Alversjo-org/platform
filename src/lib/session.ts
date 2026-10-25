import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb, schema, type Db } from '@/db';
import type { Role } from '@/db/schema';
import { getAuth } from '@/lib/auth';

export type SessionUser = { id: string; email: string; roles: Role[] };

export async function rolesFor(db: Db, userId: string): Promise<Role[]> {
  const rows = await db.select({ role: schema.userRole.role }).from(schema.userRole).where(eq(schema.userRole.userId, userId));
  return rows.map((r) => r.role);
}

export function hasAnyRole(user: { roles: Role[] }, roles: Role[]): boolean {
  return roles.some((r) => user.roles.includes(r));
}

export function isMemberAdmin(user: { roles: Role[] }): boolean {
  return hasAnyRole(user, ['admin', 'member-admin']);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const auth = await getAuth();
  const s = await auth.api.getSession({ headers: await headers() });
  if (!s) return null;
  const roles = await rolesFor(await getDb(), s.user.id);
  return { id: s.user.id, email: s.user.email, roles };
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) redirect('/login');
  return u;
}

export async function requireAnyRole(roles: Role[]): Promise<SessionUser> {
  const u = await requireUser();
  // A member who reaches a gated page is not an error to report, just someone in the
  // wrong place: send them to their own homepage.
  if (!hasAnyRole(u, roles)) redirect('/');
  return u;
}

export const requireAdmin = () => requireAnyRole(['admin']);
export const requireMemberAdmin = () => requireAnyRole(['admin', 'member-admin']);
export const requireMapper = () => requireAnyRole(['admin', 'mapper']);
export const requireRoleAdmin = () => requireAnyRole(['admin', 'role-admin']);
