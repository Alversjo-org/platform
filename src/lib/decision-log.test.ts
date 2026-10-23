import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import { logDecision } from './decision-log';

describe('logDecision', () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
  });

  it('writes one row with the diff serialized as JSON', async () => {
    await logDecision(db, { entity: 'project', entityId: 'p1', actorUserId: 'u1', action: 'status_change', diff: { from: 'draft', to: 'published' } });
    const [row] = await db.select().from(schema.decisionLog).where(eq(schema.decisionLog.entityId, 'p1'));
    expect(row).toMatchObject({ entity: 'project', entityId: 'p1', actorUserId: 'u1', action: 'status_change' });
    expect(JSON.parse(row.diff)).toEqual({ from: 'draft', to: 'published' });
  });
});
