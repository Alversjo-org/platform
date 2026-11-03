import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '@/db';

describe('wiki migration', () => {
  it('creates the full-text search index', async () => {
    const db = await createDb('pglite://memory');
    const res = await db.execute(sql`select indexname from pg_indexes where indexname = 'wiki_page_search_idx'`);
    expect((res as unknown as { rows: unknown[] }).rows).toHaveLength(1);
  });
});
