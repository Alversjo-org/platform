import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { schema, type Db } from '@/db';

export type ImportRowResult = { email: string; status: 'created' | 'skipped' | 'error'; message?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseCsv(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(',').map((cell) => cell.trim()));
}

/** CSV columns: name,email,membershipExpiresAt (membershipExpiresAt optional, ISO date, blank = never a member). */
export async function importMembers(db: Db, csvText: string): Promise<ImportRowResult[]> {
  const rows = parseCsv(csvText);
  const dataRows = rows[0]?.[1]?.toLowerCase() === 'email' ? rows.slice(1) : rows; // tolerate an optional header row
  const results: ImportRowResult[] = [];

  for (const [name, email, expiresRaw] of dataRows) {
    if (!email || !EMAIL_RE.test(email)) {
      results.push({ email: email ?? '', status: 'error', message: 'Missing or invalid email' });
      continue;
    }
    const lowerEmail = email.toLowerCase();
    const [existing] = await db.select({ id: schema.user.id }).from(schema.user).where(sql`lower(${schema.user.email}) = ${lowerEmail}`);
    if (existing) {
      results.push({ email: lowerEmail, status: 'skipped', message: 'Already a member' });
      continue;
    }
    let membershipExpiresAt: Date | null = null;
    if (expiresRaw) {
      membershipExpiresAt = new Date(expiresRaw);
      if (Number.isNaN(membershipExpiresAt.getTime())) {
        results.push({ email: lowerEmail, status: 'error', message: `Invalid date: ${expiresRaw}` });
        continue;
      }
    }
    try {
      await db.insert(schema.user).values({
        id: randomUUID(),
        email,
        name: name ?? '',
        membershipExpiresAt,
        isActiveMember: membershipExpiresAt !== null && membershipExpiresAt > new Date(),
      });
      results.push({ email: lowerEmail, status: 'created' });
    } catch (e) {
      // An unexpected DB-level failure (anything beyond the two already-validated cases above)
      // shouldn't abort the whole import and lose the rest of the batch's results.
      results.push({ email: lowerEmail, status: 'error', message: (e as Error).message });
    }
  }
  return results;
}
