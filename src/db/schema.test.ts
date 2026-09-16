import { describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from './index';

describe('schema: user visibility flags and externalPayments', () => {
  async function withUser(db: Db) {
    const [u] = await db.insert(schema.user).values({ id: 'viktor', email: 'viktor@example.org', name: 'Viktor' }).returning();
    return u;
  }

  it('defaults phoneVisible and emailVisible to false', async () => {
    const db: Db = await createDb('pglite://memory');
    const u = await withUser(db);
    expect(u.phoneVisible).toBe(false);
    expect(u.emailVisible).toBe(false);
  });

  it('inserts an external payment and rejects a duplicate (source, externalId)', async () => {
    const db: Db = await createDb('pglite://memory');
    const u = await withUser(db);
    await db.insert(schema.externalPayments).values({
      id: 'p1', userId: u.id, source: 'stripe', externalId: 'ch_1', email: u.email,
      amountCents: 10000, currency: 'sek', paidAt: new Date('2026-01-01'),
    });
    await expect(
      db.insert(schema.externalPayments).values({
        id: 'p2', userId: u.id, source: 'stripe', externalId: 'ch_1', email: u.email,
        amountCents: 10000, currency: 'sek', paidAt: new Date('2026-01-01'),
      }),
    ).rejects.toThrow();
  });

  it('allows the same externalId across different sources', async () => {
    const db: Db = await createDb('pglite://memory');
    const u = await withUser(db);
    await db.insert(schema.externalPayments).values({ id: 'p1', userId: u.id, source: 'stripe', externalId: 'x', email: u.email, amountCents: null, currency: null, paidAt: new Date() });
    await expect(
      db.insert(schema.externalPayments).values({ id: 'p2', userId: u.id, source: 'Legacy Website', externalId: 'x', email: u.email, amountCents: null, currency: null, paidAt: new Date() }),
    ).resolves.toBeDefined();
  });
});
