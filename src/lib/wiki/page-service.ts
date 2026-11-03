import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { WikiPage } from '@/db/schema';
import { slugify } from '@/lib/slug';
import { uniqueWikiSlug } from './slug';
import { extractPlainText } from './text';

export class PageNotFoundError extends Error {
  constructor(message = 'Page not found') { super(message); this.name = 'PageNotFoundError'; }
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
