import { describe, expect, it } from 'vitest';
import { createDb, schema } from '@/db';
import { createPage, PageNotFoundError, updatePage } from './page-service';
import { listRevisions, restoreRevision } from './revision-service';

describe('listRevisions / restoreRevision', () => {
  it('lists revisions newest first', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    const page = await createPage(db, { title: 'First', content: [], createdByUserId: 'u1' });
    await updatePage(db, { pageId: page.id, title: 'Second', content: [], expectedVersion: 1, editedByUserId: 'u1' });
    const revisions = await listRevisions(db, page.id);
    expect(revisions.map((r) => r.title)).toEqual(['Second', 'First']);
  });

  it('restoring an old revision creates a new current version with that revision’s content', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    const page = await createPage(db, { title: 'X', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'original' }] }], createdByUserId: 'u1' });
    const original = (await listRevisions(db, page.id))[0];
    await updatePage(db, { pageId: page.id, title: 'X', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'overwritten' }] }], expectedVersion: 1, editedByUserId: 'u1' });
    const restored = await restoreRevision(db, { pageId: page.id, revisionId: original.id, expectedVersion: 2, editedByUserId: 'u1' });
    expect(restored.version).toBe(3);
    expect(restored.searchText).toBe('original');
    expect(await listRevisions(db, page.id)).toHaveLength(3);
  });

  it('rejects a revision that belongs to another page', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    const a = await createPage(db, { title: 'A', content: [], createdByUserId: 'u1' });
    const b = await createPage(db, { title: 'B', content: [], createdByUserId: 'u1' });
    const [revOfB] = await listRevisions(db, b.id);
    await expect(restoreRevision(db, { pageId: a.id, revisionId: revOfB.id, expectedVersion: 1, editedByUserId: 'u1' })).rejects.toThrow(PageNotFoundError);
  });
});
