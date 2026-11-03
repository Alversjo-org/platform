import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@/db';
import { createPage } from './page-service';
import { searchPages } from './search';

const para = (text: string) => [{ type: 'paragraph', content: [{ type: 'text', text }] }];

describe('searchPages', () => {
  it('finds a published page by a word in its content, case-insensitively', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    await createPage(db, { title: 'Big Barn', content: para('the roof leaks'), createdByUserId: 'u1' });
    const results = await searchPages(db, 'ROOF');
    expect(results.map((p) => p.title)).toEqual(['Big Barn']);
  });

  it('finds a page by a word in its title', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    await createPage(db, { title: 'Sheep Barn', content: [], createdByUserId: 'u1' });
    expect((await searchPages(db, 'sheep')).map((p) => p.title)).toEqual(['Sheep Barn']);
  });

  it('excludes deleted pages from results', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    const page = await createPage(db, { title: 'Gone', content: para('findme'), createdByUserId: 'u1' });
    await db.update(schema.wikiPage).set({ status: 'deleted' }).where(eq(schema.wikiPage.id, page.id));
    expect(await searchPages(db, 'findme')).toHaveLength(0);
  });

  it('does not throw on query text containing tsquery special characters', async () => {
    const db = await createDb('pglite://memory');
    await expect(searchPages(db, 'roof & leak | "quoted" !bang')).resolves.toEqual([]);
  });

  it('returns nothing for a blank query', async () => {
    const db = await createDb('pglite://memory');
    expect(await searchPages(db, '   ')).toEqual([]);
  });
});
