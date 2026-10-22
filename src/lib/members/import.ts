import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { schema, type Db } from '@/db';

export type ImportRowResult = { email: string; status: 'created' | 'skipped' | 'error'; message?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Splits one CSV line on commas, honoring "quoted, fields" with "" as an escaped quote. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cell += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += c;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function parseCsv(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(splitCsvLine);
}

function parseOptionalDate(raw: string | undefined): Date | null | undefined {
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
}

/**
 * CSV columns: name,email,membershipExpiresAt,lastContactedAt,contactNotes.
 * membershipExpiresAt/lastContactedAt are optional ISO dates (blank = none; for membershipExpiresAt,
 * blank means never a member). contactNotes is optional free text; quote fields containing a comma.
 */
export async function importMembers(db: Db, csvText: string): Promise<ImportRowResult[]> {
  const rows = parseCsv(csvText);
  const dataRows = rows[0]?.[1]?.toLowerCase() === 'email' ? rows.slice(1) : rows; // tolerate an optional header row
  const results: ImportRowResult[] = [];

  for (const [name, email, expiresRaw, lastContactedRaw, contactNotes] of dataRows) {
    if (!email || !EMAIL_RE.test(email)) {
      results.push({ email: email ?? '', status: 'error', message: 'Missing or invalid email' });
      continue;
    }
    const lowerEmail = email.toLowerCase();

    const membershipExpiresAt = parseOptionalDate(expiresRaw);
    if (membershipExpiresAt === undefined) {
      results.push({ email: lowerEmail, status: 'error', message: `Invalid date: ${expiresRaw}` });
      continue;
    }
    const lastContactedAt = parseOptionalDate(lastContactedRaw);
    if (lastContactedAt === undefined) {
      results.push({ email: lowerEmail, status: 'error', message: `Invalid date: ${lastContactedRaw}` });
      continue;
    }

    const [existing] = await db.select({ id: schema.user.id }).from(schema.user).where(sql`lower(${schema.user.email}) = ${lowerEmail}`);
    if (existing) {
      // Only touch fields the row actually supplies, so re-importing an old roster without these
      // columns at all doesn't wipe out contact info gathered since the last import.
      const updates: { lastContactedAt?: Date | null; contactNotes?: string | null } = {};
      if (lastContactedRaw !== undefined) updates.lastContactedAt = lastContactedAt;
      if (contactNotes !== undefined) updates.contactNotes = contactNotes || null;
      if (Object.keys(updates).length > 0) {
        await db.update(schema.user).set(updates).where(eq(schema.user.id, existing.id));
      }
      results.push({ email: lowerEmail, status: 'skipped', message: 'Already a member' });
      continue;
    }
    try {
      await db.insert(schema.user).values({
        id: randomUUID(),
        email,
        name: name ?? '',
        membershipExpiresAt,
        isActiveMember: membershipExpiresAt !== null && membershipExpiresAt > new Date(),
        lastContactedAt,
        contactNotes: contactNotes || null,
      });
      results.push({ email: lowerEmail, status: 'created' });
    } catch (e) {
      // An unexpected DB-level failure (anything beyond the already-validated cases above)
      // shouldn't abort the whole import and lose the rest of the batch's results.
      results.push({ email: lowerEmail, status: 'error', message: (e as Error).message });
    }
  }
  return results;
}
