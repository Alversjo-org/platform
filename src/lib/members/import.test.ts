import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, schema, type Db } from '@/db';
import { importMembers } from './import';

describe('importMembers', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'existing', email: 'existing@example.org', name: 'Existing' });
  });

  it('creates new members from CSV rows, deriving isActiveMember from the expiry date', async () => {
    const results = await importMembers(
      db,
      'name,email,membershipExpiresAt\nViktor,viktor@example.org,2099-01-01\nNoExpiry,noexpiry@example.org,',
    );
    expect(results).toEqual([
      { email: 'viktor@example.org', status: 'created' },
      { email: 'noexpiry@example.org', status: 'created' },
    ]);
    const [viktor] = await db.select().from(schema.user).where(eq(schema.user.email, 'viktor@example.org'));
    expect(viktor).toMatchObject({ name: 'Viktor', isActiveMember: true });
    const [noExpiry] = await db.select().from(schema.user).where(eq(schema.user.email, 'noexpiry@example.org'));
    expect(noExpiry).toMatchObject({ isActiveMember: false, membershipExpiresAt: null });
  });

  it('skips a row matching an existing member by email case-insensitively, without overwriting it', async () => {
    const results = await importMembers(db, 'name,email,membershipExpiresAt\nNew Name,Existing@Example.org,2099-01-01');
    expect(results).toEqual([{ email: 'existing@example.org', status: 'skipped', message: 'Already a member' }]);
    const [row] = await db.select().from(schema.user).where(eq(schema.user.email, 'existing@example.org'));
    expect(row.name).toBe('Existing');
  });

  it('reports a bad row without failing the rest of the batch', async () => {
    const results = await importMembers(db, 'name,email,membershipExpiresAt\nBad,not-an-email,\nGood,good@example.org,');
    expect(results[0]).toMatchObject({ status: 'error' });
    expect(results[1]).toMatchObject({ status: 'created' });
  });

  it('reports an invalid date without failing the row before it', async () => {
    const results = await importMembers(db, 'name,email,membershipExpiresAt\nGood,good@example.org,\nBad,bad@example.org,not-a-date');
    expect(results[0]).toMatchObject({ status: 'created' });
    expect(results[1]).toMatchObject({ status: 'error' });
  });
});
