import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import type { SessionUser } from '@/lib/session';
import { assertEventPermission, canViewEvent, getEventRole, NotAuthorizedError } from './authorization';

describe('event authorization', () => {
  let db: Db;
  const lead: SessionUser = { id: 'lead1', email: 'lead@example.org', role: 'member' };
  const cocreator: SessionUser = { id: 'co1', email: 'co@example.org', role: 'member' };
  const stranger: SessionUser = { id: 'stranger1', email: 'stranger@example.org', role: 'member' };
  const admin: SessionUser = { id: 'admin1', email: 'admin@example.org', role: 'admin' };

  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.user).values([
      { id: 'lead1', email: 'lead@example.org' }, { id: 'co1', email: 'co@example.org' },
      { id: 'stranger1', email: 'stranger@example.org' }, { id: 'admin1', email: 'admin@example.org', role: 'admin' },
    ]);
    await db.insert(schema.project).values({ id: 'p1', slug: 'p1', title: 'Test', kind: 'event', ownerUserId: 'lead1' });
    await db.insert(schema.projectMember).values([
      { projectId: 'p1', userId: 'lead1', role: 'lead' }, { projectId: 'p1', userId: 'co1', role: 'cocreator' },
    ]);
  });

  it('getEventRole returns the project_member role, "override" for admin, or null for a stranger', async () => {
    expect(await getEventRole(db, 'p1', lead)).toBe('lead');
    expect(await getEventRole(db, 'p1', cocreator)).toBe('cocreator');
    expect(await getEventRole(db, 'p1', admin)).toBe('override');
    expect(await getEventRole(db, 'p1', stranger)).toBeNull();
  });

  it('a lead and an admin/member-admin can editDetails and manage', async () => {
    await expect(assertEventPermission(db, 'p1', lead, 'editDetails')).resolves.toBeUndefined();
    await expect(assertEventPermission(db, 'p1', lead, 'manage')).resolves.toBeUndefined();
    await expect(assertEventPermission(db, 'p1', admin, 'manage')).resolves.toBeUndefined();
  });

  it('a cocreator can editDetails but not manage', async () => {
    await expect(assertEventPermission(db, 'p1', cocreator, 'editDetails')).resolves.toBeUndefined();
    await expect(assertEventPermission(db, 'p1', cocreator, 'manage')).rejects.toBeInstanceOf(NotAuthorizedError);
  });

  it('a stranger can do neither', async () => {
    await expect(assertEventPermission(db, 'p1', stranger, 'editDetails')).rejects.toBeInstanceOf(NotAuthorizedError);
  });
});

describe('canViewEvent', () => {
  it('a published event is visible to anyone, organiser or not', () => {
    expect(canViewEvent('published', null)).toBe(true);
    expect(canViewEvent('published', 'lead')).toBe(true);
  });

  it('a draft, cancelled, closed, or archived event is visible only to an organiser or override', () => {
    for (const status of ['draft', 'cancelled', 'closed', 'archived'] as const) {
      expect(canViewEvent(status, null)).toBe(false);
      expect(canViewEvent(status, 'lead')).toBe(true);
      expect(canViewEvent(status, 'cocreator')).toBe(true);
      expect(canViewEvent(status, 'override')).toBe(true);
    }
  });
});
