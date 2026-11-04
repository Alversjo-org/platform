import { and, eq, sql } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { WikiPage } from '@/db/schema';

// Must match the expression in the GIN index (wiki_page_search_idx) so the index can be used.
const document = sql`to_tsvector('english', coalesce(${schema.wikiPage.title}, '') || ' ' || coalesce(${schema.wikiPage.searchText}, ''))`;

/** Plain-language full-text search over published pages. plainto_tsquery tokenizes raw input safely, so no escaping. */
export async function searchPages(db: Db, query: string): Promise<WikiPage[]> {
  const q = query.trim();
  if (!q) return [];
  const tsquery = sql`plainto_tsquery('english', ${q})`;
  return db.select().from(schema.wikiPage)
    .where(and(eq(schema.wikiPage.status, 'published'), sql`${document} @@ ${tsquery}`))
    .orderBy(sql`ts_rank(${document}, ${tsquery}) desc`, schema.wikiPage.title)
    .limit(50);
}
