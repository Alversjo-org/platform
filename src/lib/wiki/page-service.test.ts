import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@/db';
import { createPage, deletePage, getPageBySlug, getPageTree, InvalidMoveError, movePage, PageConflictError, PageHasChildrenError, restorePage, updatePage } from './page-service';

describe('createPage / getPageBySlug', () => {
  it('creates a page with version 1 and an initial revision', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    const page = await createPage(db, { title: 'Big Barn', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }], createdByUserId: 'u1' });
    expect(page.version).toBe(1);
    expect(page.slug).toBe('big-barn');
    expect(page.searchText).toBe('hi');
    const revisions = await db.select().from(schema.wikiPageRevision).where(eq(schema.wikiPageRevision.pageId, page.id));
    expect(revisions).toHaveLength(1);
  });

  it('getPageBySlug returns null for a missing or deleted page', async () => {
    const db = await createDb('pglite://memory');
    expect(await getPageBySlug(db, 'nope')).toBeNull();
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    const page = await createPage(db, { title: 'X', content: [], createdByUserId: 'u1' });
    await db.update(schema.wikiPage).set({ status: 'deleted' }).where(eq(schema.wikiPage.id, page.id));
    expect(await getPageBySlug(db, page.slug)).toBeNull();
  });
});

describe('getPageTree', () => {
  it('nests children under their parent, ordered by position, and excludes deleted pages', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    const root = await createPage(db, { title: 'Buildings', content: [], createdByUserId: 'u1' });
    const child = await createPage(db, { title: 'Big Barn', content: [], parentId: root.id, createdByUserId: 'u1' });
    const deleted = await createPage(db, { title: 'Gone', content: [], parentId: root.id, createdByUserId: 'u1' });
    await db.update(schema.wikiPage).set({ status: 'deleted' }).where(eq(schema.wikiPage.id, deleted.id));
    const tree = await getPageTree(db);
    expect(tree).toEqual([{ id: root.id, slug: 'buildings', title: 'Buildings', children: [{ id: child.id, slug: 'big-barn', title: 'Big Barn', children: [] }] }]);
  });

  it('orders siblings by position', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    const a = await createPage(db, { title: 'A', content: [], createdByUserId: 'u1' });
    const b = await createPage(db, { title: 'B', content: [], createdByUserId: 'u1' });
    await db.update(schema.wikiPage).set({ position: 1 }).where(eq(schema.wikiPage.id, a.id));
    await db.update(schema.wikiPage).set({ position: 0 }).where(eq(schema.wikiPage.id, b.id));
    expect((await getPageTree(db)).map((n) => n.title)).toEqual(['B', 'A']);
  });
});

describe('updatePage', () => {
  it('bumps the version, updates searchText, and writes a revision', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    const page = await createPage(db, { title: 'X', content: [], createdByUserId: 'u1' });
    const updated = await updatePage(db, { pageId: page.id, title: 'X', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'new text' }] }], expectedVersion: 1, editedByUserId: 'u1' });
    expect(updated.version).toBe(2);
    expect(updated.searchText).toBe('new text');
    const revisions = await db.select().from(schema.wikiPageRevision).where(eq(schema.wikiPageRevision.pageId, page.id));
    expect(revisions).toHaveLength(2);
  });

  it('rejects a stale expectedVersion without changing anything', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    const page = await createPage(db, { title: 'X', content: [], createdByUserId: 'u1' });
    await updatePage(db, { pageId: page.id, title: 'X', content: [], expectedVersion: 1, editedByUserId: 'u1' });
    await expect(updatePage(db, { pageId: page.id, title: 'stale write', content: [], expectedVersion: 1, editedByUserId: 'u1' })).rejects.toThrow(PageConflictError);
    const [row] = await db.select().from(schema.wikiPage).where(eq(schema.wikiPage.id, page.id));
    expect(row.title).toBe('X');
    const revisions = await db.select().from(schema.wikiPageRevision).where(eq(schema.wikiPageRevision.pageId, page.id));
    expect(revisions).toHaveLength(2);
  });

  it('keeps the slug when the title changes', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    const page = await createPage(db, { title: 'Old name', content: [], createdByUserId: 'u1' });
    const updated = await updatePage(db, { pageId: page.id, title: 'New name', content: [], expectedVersion: 1, editedByUserId: 'u1' });
    expect(updated.slug).toBe('old-name');
  });
});

describe('deletePage / restorePage', () => {
  it('blocks deleting a page with a published child', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    const parent = await createPage(db, { title: 'Buildings', content: [], createdByUserId: 'u1' });
    await createPage(db, { title: 'Big Barn', content: [], parentId: parent.id, createdByUserId: 'u1' });
    await expect(deletePage(db, parent.id)).rejects.toThrow(PageHasChildrenError);
  });

  it('deletes then restores a childless page', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    const page = await createPage(db, { title: 'X', content: [], createdByUserId: 'u1' });
    await deletePage(db, page.id);
    expect(await getPageBySlug(db, page.slug)).toBeNull();
    const restored = await restorePage(db, page.id);
    expect(restored.status).toBe('published');
    expect(await getPageBySlug(db, page.slug)).not.toBeNull();
  });
});

describe('movePage', () => {
  it('changes parentId and position without bumping version', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    const parent = await createPage(db, { title: 'Buildings', content: [], createdByUserId: 'u1' });
    const page = await createPage(db, { title: 'X', content: [], createdByUserId: 'u1' });
    const moved = await movePage(db, { pageId: page.id, parentId: parent.id, position: 3 });
    expect(moved.parentId).toBe(parent.id);
    expect(moved.position).toBe(3);
    expect(moved.version).toBe(1);
  });

  it('refuses to move a page under itself or its own descendant', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    const a = await createPage(db, { title: 'A', content: [], createdByUserId: 'u1' });
    const b = await createPage(db, { title: 'B', content: [], parentId: a.id, createdByUserId: 'u1' });
    await expect(movePage(db, { pageId: a.id, parentId: a.id, position: 0 })).rejects.toThrow(InvalidMoveError);
    await expect(movePage(db, { pageId: a.id, parentId: b.id, position: 0 })).rejects.toThrow(InvalidMoveError);
  });
});
