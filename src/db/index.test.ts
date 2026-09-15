import { describe, expect, it } from 'vitest';
import { createDb, schema } from './index';

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
});
