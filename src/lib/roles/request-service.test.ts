import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import { decideRoleRequest, hasPendingRequest, listPendingRoleRequests, requestRole, RequestNotPendingError, RoleNotSelfRequestableError } from './request-service';

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

describe('listPendingRoleRequests', () => {
  it('lists only pending requests, with the requesting user’s email and name', async () => {
    const db: Db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org', name: 'Uno' });
    await requestRole(db, { userId: 'u1', role: 'wiki-editor' });
    const list = await listPendingRoleRequests(db);
    expect(list).toEqual([expect.objectContaining({ userId: 'u1', userEmail: 'u1@example.org', userName: 'Uno', status: 'pending' })]);
  });
});

describe('decideRoleRequest', () => {
  it('approving grants the role, marks the request approved, and logs a decision', async () => {
    const db: Db = await createDb('pglite://memory');
    await db.insert(schema.user).values([{ id: 'u1', email: 'u1@example.org' }, { id: 'admin1', email: 'a@example.org' }]);
    const req = await requestRole(db, { userId: 'u1', role: 'wiki-editor' });
    await decideRoleRequest(db, { actor: { id: 'admin1' }, requestId: req.id, approve: true });
    const [granted] = await db.select().from(schema.userRole).where(eq(schema.userRole.userId, 'u1'));
    expect(granted.role).toBe('wiki-editor');
    const [updated] = await db.select().from(schema.roleRequest).where(eq(schema.roleRequest.id, req.id));
    expect(updated.status).toBe('approved');
    expect(updated.decidedByUserId).toBe('admin1');
  });

  it('denying does not grant the role', async () => {
    const db: Db = await createDb('pglite://memory');
    await db.insert(schema.user).values([{ id: 'u1', email: 'u1@example.org' }, { id: 'admin1', email: 'a@example.org' }]);
    const req = await requestRole(db, { userId: 'u1', role: 'wiki-editor' });
    await decideRoleRequest(db, { actor: { id: 'admin1' }, requestId: req.id, approve: false });
    const granted = await db.select().from(schema.userRole).where(eq(schema.userRole.userId, 'u1'));
    expect(granted).toHaveLength(0);
    const [updated] = await db.select().from(schema.roleRequest).where(eq(schema.roleRequest.id, req.id));
    expect(updated.status).toBe('denied');
  });

  it('rejects deciding a request that is not pending', async () => {
    const db: Db = await createDb('pglite://memory');
    await db.insert(schema.user).values([{ id: 'u1', email: 'u1@example.org' }, { id: 'admin1', email: 'a@example.org' }]);
    const req = await requestRole(db, { userId: 'u1', role: 'wiki-editor' });
    await decideRoleRequest(db, { actor: { id: 'admin1' }, requestId: req.id, approve: true });
    await expect(decideRoleRequest(db, { actor: { id: 'admin1' }, requestId: req.id, approve: true })).rejects.toThrow(RequestNotPendingError);
  });
});

describe('hasPendingRequest', () => {
  it('is true only while a request for that role is pending', async () => {
    const db: Db = await createDb('pglite://memory');
    await db.insert(schema.user).values([{ id: 'u1', email: 'u1@example.org' }, { id: 'a', email: 'a@example.org' }]);
    expect(await hasPendingRequest(db, { userId: 'u1', role: 'wiki-editor' })).toBe(false);
    const req = await requestRole(db, { userId: 'u1', role: 'wiki-editor' });
    expect(await hasPendingRequest(db, { userId: 'u1', role: 'wiki-editor' })).toBe(true);
    expect(await hasPendingRequest(db, { userId: 'a', role: 'wiki-editor' })).toBe(false);
    await decideRoleRequest(db, { actor: { id: 'a' }, requestId: req.id, approve: false });
    expect(await hasPendingRequest(db, { userId: 'u1', role: 'wiki-editor' })).toBe(false);
  });
});
