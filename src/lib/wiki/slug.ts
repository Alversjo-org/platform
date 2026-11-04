import { eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';

/** Fixed routes under /wiki that a [slug] segment must never shadow. */
const RESERVED = new Set(['new', 'search']);

/** First free slug of `base`, `base-2`, `base-3`… Deleted pages keep their slug, so they count as taken. */
export async function uniqueWikiSlug(db: Db, base: string): Promise<string> {
  const root = base || 'page';
  let candidate = root;
  let n = 2;
  for (;;) {
    const [hit] = await db.select({ id: schema.wikiPage.id }).from(schema.wikiPage).where(eq(schema.wikiPage.slug, candidate));
    if (!hit && !RESERVED.has(candidate)) return candidate;
    candidate = `${root}-${n}`;
    n += 1;
  }
}
