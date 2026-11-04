import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { WikiPage } from '@/db/schema';
import { slugify } from '@/lib/slug';
import { uniqueWikiSlug } from './slug';
import { extractPlainText } from './text';

export class PageNotFoundError extends Error {
  constructor(message = 'Page not found') { super(message); this.name = 'PageNotFoundError'; }
}

export class PageConflictError extends Error {
  constructor(message = 'This page was changed by someone else since you opened it') { super(message); this.name = 'PageConflictError'; }
}

export class PageHasChildrenError extends Error {
  constructor(message = 'Move or delete the sub-pages first') { super(message); this.name = 'PageHasChildrenError'; }
}

export class InvalidMoveError extends Error {
  constructor(message = 'A page cannot be moved under itself or one of its sub-pages') { super(message); this.name = 'InvalidMoveError'; }
}

export type WikiPageTreeNode = { id: string; slug: string; title: string; children: WikiPageTreeNode[] };

export async function createPage(
  db: Db,
  input: { title: string; content: unknown; parentId?: string | null; createdByUserId: string },
): Promise<WikiPage> {
  const slug = await uniqueWikiSlug(db, slugify(input.title));
  return db.transaction(async (tx) => {
    const [page] = await tx.insert(schema.wikiPage).values({
      id: randomUUID(),
      slug,
      title: input.title,
      content: input.content,
      searchText: extractPlainText(input.content),
      parentId: input.parentId ?? null,
      version: 1,
      createdByUserId: input.createdByUserId,
    }).returning();
    await tx.insert(schema.wikiPageRevision).values({
      id: randomUUID(), pageId: page.id, title: page.title, content: page.content, editedByUserId: input.createdByUserId,
    });
    return page;
  });
}

export async function getPageBySlug(db: Db, slug: string): Promise<WikiPage | null> {
  const [row] = await db.select().from(schema.wikiPage)
    .where(and(eq(schema.wikiPage.slug, slug), eq(schema.wikiPage.status, 'published')));
  return row ?? null;
}

export async function getPageTree(db: Db): Promise<WikiPageTreeNode[]> {
  const rows = await db.select().from(schema.wikiPage)
    .where(eq(schema.wikiPage.status, 'published'))
    .orderBy(asc(schema.wikiPage.position), asc(schema.wikiPage.createdAt));
  const byParent = new Map<string | null, WikiPage[]>();
  for (const r of rows) {
    const list = byParent.get(r.parentId) ?? [];
    list.push(r);
    byParent.set(r.parentId, list);
  }
  const build = (parentId: string | null): WikiPageTreeNode[] =>
    (byParent.get(parentId) ?? []).map((p) => ({ id: p.id, slug: p.slug, title: p.title, children: build(p.id) }));
  return build(null);
}

/** Optimistic-locked save: rejects with PageConflictError unless `expectedVersion` is still current. Writes a full revision snapshot. */
export async function updatePage(
  db: Db,
  input: { pageId: string; title: string; content: unknown; expectedVersion: number; editedByUserId: string },
): Promise<WikiPage> {
  return db.transaction(async (tx) => {
    const [page] = await tx.update(schema.wikiPage)
      .set({
        title: input.title,
        content: input.content,
        searchText: extractPlainText(input.content),
        version: sql`${schema.wikiPage.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.wikiPage.id, input.pageId),
        eq(schema.wikiPage.version, input.expectedVersion),
        eq(schema.wikiPage.status, 'published'),
      ))
      .returning();
    if (!page) {
      const [exists] = await tx.select({ id: schema.wikiPage.id }).from(schema.wikiPage).where(eq(schema.wikiPage.id, input.pageId));
      throw exists ? new PageConflictError() : new PageNotFoundError();
    }
    await tx.insert(schema.wikiPageRevision).values({
      id: randomUUID(), pageId: page.id, title: page.title, content: page.content, editedByUserId: input.editedByUserId,
    });
    return page;
  });
}

/** Reparent/reorder. Not version-locked and writes no revision: the tree is navigation, not content. */
export async function movePage(db: Db, input: { pageId: string; parentId: string | null; position: number }): Promise<WikiPage> {
  // Walk up from the new parent; hitting the page itself would create a cycle.
  for (let cursor = input.parentId; cursor; ) {
    if (cursor === input.pageId) throw new InvalidMoveError();
    const [parent] = await db.select({ parentId: schema.wikiPage.parentId }).from(schema.wikiPage).where(eq(schema.wikiPage.id, cursor));
    cursor = parent?.parentId ?? null;
  }
  const [row] = await db.update(schema.wikiPage)
    .set({ parentId: input.parentId, position: input.position })
    .where(eq(schema.wikiPage.id, input.pageId))
    .returning();
  if (!row) throw new PageNotFoundError();
  return row;
}

export async function deletePage(db: Db, pageId: string): Promise<void> {
  const children = await db.select({ id: schema.wikiPage.id }).from(schema.wikiPage)
    .where(and(eq(schema.wikiPage.parentId, pageId), eq(schema.wikiPage.status, 'published')))
    .limit(1);
  if (children.length > 0) throw new PageHasChildrenError();
  const [row] = await db.update(schema.wikiPage).set({ status: 'deleted', updatedAt: new Date() }).where(eq(schema.wikiPage.id, pageId)).returning();
  if (!row) throw new PageNotFoundError();
}

/** Deleted pages, most recently deleted first (deletePage stamps updatedAt). */
export function listDeletedPages(db: Db): Promise<WikiPage[]> {
  return db.select().from(schema.wikiPage)
    .where(eq(schema.wikiPage.status, 'deleted'))
    .orderBy(desc(schema.wikiPage.updatedAt));
}

/** Un-deletes a page. If its parent is no longer published it moves to top level, so it can't vanish from the tree. */
export async function restorePage(db: Db, pageId: string): Promise<WikiPage> {
  const [page] = await db.select().from(schema.wikiPage).where(eq(schema.wikiPage.id, pageId));
  if (!page) throw new PageNotFoundError();
  let parentId = page.parentId;
  if (parentId) {
    const [parent] = await db.select({ status: schema.wikiPage.status }).from(schema.wikiPage).where(eq(schema.wikiPage.id, parentId));
    if (!parent || parent.status !== 'published') parentId = null;
  }
  const [row] = await db.update(schema.wikiPage)
    .set({ status: 'published', parentId, updatedAt: new Date() })
    .where(eq(schema.wikiPage.id, pageId))
    .returning();
  return row;
}
