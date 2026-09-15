import { describe, expect, it } from 'vitest';
import { createDb, getDb, schema } from './index';

describe('createDb', () => {
  it('opens an in-memory PGlite database with migrations applied', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'a@example.org' });
    const rows = await db.select().from(schema.user);
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe('member');
  });

  it('enforces the box_access primary key', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'a@example.org' });
    await db.insert(schema.boxes).values({ id: 'b1', name: 'b', profile: 'contributor', jwtSecret: 's', ownerUserId: 'u1' });
    await db.insert(schema.boxAccess).values({ boxId: 'b1', userId: 'u1', grantedByUserId: 'u1' });
    await expect(
      db.insert(schema.boxAccess).values({ boxId: 'b1', userId: 'u1', grantedByUserId: 'u1' }),
    ).rejects.toThrow();
  });

  it('refuses a non-postgres DATABASE_URL in production', async () => {
    // Next types NODE_ENV as read-only; this test is exactly the case where it isn't.
    const env = process.env as Record<string, string | undefined>;
    const prev = env.NODE_ENV;
    try {
      env.NODE_ENV = 'production';
      await expect(createDb('pglite://memory')).rejects.toThrow('DATABASE_URL must be a postgres:// URL in production');
    } finally {
      env.NODE_ENV = prev;
    }
  });
});

describe('getDb', () => {
  it('does not keep a failed open cached', async () => {
    const prev = process.env.DATABASE_URL;
    try {
      // Nothing listens on port 1, so the first open fails while connecting.
      process.env.DATABASE_URL = 'postgres://127.0.0.1:1/x';
      await expect(getDb()).rejects.toThrow();

      process.env.DATABASE_URL = 'pglite://memory';
      const db = await getDb();
      await db.insert(schema.user).values({ id: 'u1', email: 'a@example.org' });
      expect(await db.select().from(schema.user)).toHaveLength(1);
    } finally {
      if (prev === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prev;
    }
  });
});
