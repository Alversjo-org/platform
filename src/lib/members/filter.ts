// Pure helpers shared by the members and roles pages. No server-only imports, so client
// components can use them.

export type Searchable = { name: string; nickname?: string | null; email: string };

/** Matches on name, nickname or email, case-insensitively. A blank query matches everyone. */
export function matchesQuery(m: Searchable, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [m.name, m.nickname ?? '', m.email].some((s) => s.toLowerCase().includes(q));
}

export function filterMembers<T extends Searchable>(members: T[], query: string): T[] {
  return members.filter((m) => matchesQuery(m, query));
}

/** URL for the members list with a status tab and optional search text. */
export function membersSearchHref(status: string, query: string): string {
  const q = query.trim();
  return `/members?status=${status}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
}

/** Where a role grant should land, so the roles list stays filtered to the same search. */
export function rolesReturnTo(query: string): string {
  const q = query.trim();
  return q ? `/roles?q=${encodeURIComponent(q)}` : '/roles';
}
