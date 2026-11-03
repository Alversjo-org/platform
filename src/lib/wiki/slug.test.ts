import { describe, expect, it } from 'vitest';
import { createDb, schema } from '@/db';
import { uniqueWikiSlug } from './slug';

describe('uniqueWikiSlug', () => {
  it('appends -2, -3 on collision, matching projects/service.ts’s uniqueSlug', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    await db.insert(schema.wikiPage).values({ id: 'p1', slug: 'big-barn', title: 'Big Barn', content: [], createdByUserId: 'u1' });
    expect(await uniqueWikiSlug(db, 'big-barn')).toBe('big-barn-2');
    expect(await uniqueWikiSlug(db, 'sheep-barn')).toBe('sheep-barn');
    await db.insert(schema.wikiPage).values({ id: 'p2', slug: 'big-barn-2', title: 'Big Barn', content: [], createdByUserId: 'u1' });
    expect(await uniqueWikiSlug(db, 'big-barn')).toBe('big-barn-3');
  });

  it('counts deleted pages as taken, since slugs are permanent', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    await db.insert(schema.wikiPage).values({ id: 'p1', slug: 'gone', title: 'Gone', content: [], status: 'deleted', createdByUserId: 'u1' });
    expect(await uniqueWikiSlug(db, 'gone')).toBe('gone-2');
  });

  it('never hands out slugs that collide with fixed /wiki routes', async () => {
    const db = await createDb('pglite://memory');
    expect(await uniqueWikiSlug(db, 'new')).toBe('new-2');
    expect(await uniqueWikiSlug(db, 'search')).toBe('search-2');
  });
});
