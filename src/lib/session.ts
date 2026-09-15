import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Role } from '@/db/schema';
import { getAuth } from '@/lib/auth';

export type SessionUser = { id: string; email: string; role: Role };

export async function getSessionUser(): Promise<SessionUser | null> {
  const auth = await getAuth();
  const s = await auth.api.getSession({ headers: await headers() });
  if (!s) return null;
  const role = (s.user as { role?: string }).role === 'admin' ? 'admin' : 'member';
  return { id: s.user.id, email: s.user.email, role };
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) redirect('/login');
  return u;
}

export async function requireAdmin(): Promise<SessionUser> {
  const u = await requireUser();
  if (u.role !== 'admin') throw new Error('Admins only');
  return u;
}
