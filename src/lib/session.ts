import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Role } from '@/db/schema';
import { getAuth } from '@/lib/auth';

export type SessionUser = { id: string; email: string; role: Role };

export function roleFromRaw(raw: string | undefined): Role {
  if (raw === 'admin') return 'admin';
  if (raw === 'member-admin') return 'member-admin';
  return 'member';
}

export function isMemberAdmin(user: { role: Role }): boolean {
  return user.role === 'admin' || user.role === 'member-admin';
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const auth = await getAuth();
  const s = await auth.api.getSession({ headers: await headers() });
  if (!s) return null;
  const role = roleFromRaw((s.user as { role?: string }).role);
  return { id: s.user.id, email: s.user.email, role };
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) redirect('/login');
  return u;
}

export async function requireAdmin(): Promise<SessionUser> {
  const u = await requireUser();
  // A member who reaches an admin page is not an error to report, just someone in the
  // wrong place: send them to their own homepage.
  if (u.role !== 'admin') redirect('/');
  return u;
}

export async function requireMemberAdmin(): Promise<SessionUser> {
  const u = await requireUser();
  if (!isMemberAdmin(u)) redirect('/');
  return u;
}
