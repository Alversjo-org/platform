import { describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import { requestRole, RoleNotSelfRequestableError } from './request-service';

describe('requestRole', () => {
  it('creates a pending request for a self-requestable role', async () => {
    const db: Db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    const req = await requestRole(db, { userId: 'u1', role: 'wiki-editor' });
    expect(req.status).toBe('pending');
    expect(req.userId).toBe('u1');
  });

  it('is a no-op and returns the existing row if a pending request already exists', async () => {
    const db: Db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    const first = await requestRole(db, { userId: 'u1', role: 'wiki-editor' });
    const second = await requestRole(db, { userId: 'u1', role: 'wiki-editor' });
    expect(second.id).toBe(first.id);
    const rows = await db.select().from(schema.roleRequest);
    expect(rows).toHaveLength(1);
  });

  it('is a no-op if the user already holds the role', async () => {
    const db: Db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    await db.insert(schema.userRole).values({ userId: 'u1', role: 'wiki-editor' });
    await requestRole(db, { userId: 'u1', role: 'wiki-editor' });
    const rows = await db.select().from(schema.roleRequest);
    expect(rows).toHaveLength(0);
  });

  it('rejects a role that is not self-requestable', async () => {
    const db: Db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    await expect(requestRole(db, { userId: 'u1', role: 'mapper' })).rejects.toThrow(RoleNotSelfRequestableError);
  });
});
