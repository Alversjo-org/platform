import { describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import { transitionStatus } from '@/lib/projects/service';
import { createPurchaseProject, listPurchaseProjects } from './purchase-service';

describe('createPurchaseProject', () => {
  it('creates a published purchase-kind project owned by the creator', async () => {
    const db: Db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    const p = await createPurchaseProject(db, { title: 'Woodchipper', summary: 'For clearing brush', ownerUserId: 'u1' });
    expect(p.kind).toBe('purchase');
    expect(p.status).toBe('published');
    expect(p.ownerUserId).toBe('u1');
  });

  it('gives colliding titles distinct slugs', async () => {
    const db: Db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    const a = await createPurchaseProject(db, { title: 'Ladder', summary: '', ownerUserId: 'u1' });
    const b = await createPurchaseProject(db, { title: 'Ladder', summary: '', ownerUserId: 'u1' });
    expect(a.slug).not.toBe(b.slug);
  });
});

describe('listPurchaseProjects', () => {
  it('lists only published purchase-kind projects', async () => {
    const db: Db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    const wanted = await createPurchaseProject(db, { title: 'Tractor', summary: '', ownerUserId: 'u1' });
    const fulfilled = await createPurchaseProject(db, { title: 'Digger', summary: '', ownerUserId: 'u1' });
    await transitionStatus(db, { projectId: fulfilled.id, to: 'closed', actorUserId: 'u1' });
    await db.insert(schema.project).values({ id: 'e1', slug: 'e1', title: 'An event', kind: 'event', status: 'published', ownerUserId: 'u1' });
    const list = await listPurchaseProjects(db);
    expect(list.map((p) => p.id)).toEqual([wanted.id]);
  });
});
