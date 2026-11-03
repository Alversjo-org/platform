import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@/db';
import { createPage, getPageBySlug, getPageTree } from './page-service';

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
