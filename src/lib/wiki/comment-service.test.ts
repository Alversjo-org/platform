import { describe, expect, it } from 'vitest';
import { createDb, schema } from '@/db';
import { addComment, CommentForbiddenError, CommentNotFoundError, deleteComment, listComments } from './comment-service';
import { createPage } from './page-service';

describe('comment-service', () => {
  it('adds and lists comments oldest-first, with author info joined in', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org', name: 'Uno' });
    const page = await createPage(db, { title: 'X', content: [], createdByUserId: 'u1' });
    await addComment(db, { pageId: page.id, authorUserId: 'u1', body: 'first' });
    await addComment(db, { pageId: page.id, authorUserId: 'u1', body: 'second' });
    const list = await listComments(db, page.id);
    expect(list.map((c) => c.body)).toEqual(['first', 'second']);
    expect(list[0].authorName).toBe('Uno');
    expect(list[0].authorEmail).toBe('u1@example.org');
  });

  it('lets the author delete their own comment', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    const page = await createPage(db, { title: 'X', content: [], createdByUserId: 'u1' });
    const c = await addComment(db, { pageId: page.id, authorUserId: 'u1', body: 'x' });
    await deleteComment(db, { commentId: c.id, actor: { id: 'u1', roles: [] } });
    expect(await listComments(db, page.id)).toHaveLength(0);
  });

  it('lets an admin or wiki-editor delete someone else’s comment', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values([{ id: 'u1', email: 'u1@example.org' }, { id: 'mod', email: 'mod@example.org' }]);
    const page = await createPage(db, { title: 'X', content: [], createdByUserId: 'u1' });
    const c = await addComment(db, { pageId: page.id, authorUserId: 'u1', body: 'x' });
    await deleteComment(db, { commentId: c.id, actor: { id: 'mod', roles: ['wiki-editor'] } });
    expect(await listComments(db, page.id)).toHaveLength(0);
  });

  it('rejects deleting someone else’s comment without admin/wiki-editor', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values([{ id: 'u1', email: 'u1@example.org' }, { id: 'u2', email: 'u2@example.org' }]);
    const page = await createPage(db, { title: 'X', content: [], createdByUserId: 'u1' });
    const c = await addComment(db, { pageId: page.id, authorUserId: 'u1', body: 'x' });
    await expect(deleteComment(db, { commentId: c.id, actor: { id: 'u2', roles: [] } })).rejects.toThrow(CommentForbiddenError);
    expect(await listComments(db, page.id)).toHaveLength(1);
  });

  it('throws CommentNotFoundError for an unknown comment', async () => {
    const db = await createDb('pglite://memory');
    await expect(deleteComment(db, { commentId: 'nope', actor: { id: 'u1', roles: ['admin'] } })).rejects.toThrow(CommentNotFoundError);
  });
});
