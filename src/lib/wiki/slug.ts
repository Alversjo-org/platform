import { eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';

/** First free slug of `base`, `base-2`, `base-3`… Deleted pages keep their slug, so they count as taken. */
export async function uniqueWikiSlug(db: Db, base: string): Promise<string> {
  const root = base || 'page';
  let candidate = root;
  let n = 2;
  for (;;) {
    const [hit] = await db.select({ id: schema.wikiPage.id }).from(schema.wikiPage).where(eq(schema.wikiPage.slug, candidate));
    if (!hit) return candidate;
    candidate = `${root}-${n}`;
    n += 1;
  }
}
