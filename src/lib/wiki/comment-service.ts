import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { Role, WikiPageComment } from '@/db/schema';
import { hasAnyRole } from '@/lib/session';

export class CommentNotFoundError extends Error {
  constructor(message = 'Comment not found') { super(message); this.name = 'CommentNotFoundError'; }
}

export class CommentForbiddenError extends Error {
  constructor(message = 'You can only delete your own comments') { super(message); this.name = 'CommentForbiddenError'; }
}

export async function addComment(db: Db, input: { pageId: string; authorUserId: string; body: string }): Promise<WikiPageComment> {
  const [row] = await db.insert(schema.wikiPageComment).values({
    id: randomUUID(), pageId: input.pageId, authorUserId: input.authorUserId, body: input.body,
  }).returning();
  return row;
}

export async function listComments(
  db: Db,
  pageId: string,
): Promise<Array<WikiPageComment & { authorName: string | null; authorEmail: string }>> {
  const rows = await db
    .select({ comment: schema.wikiPageComment, authorName: schema.user.name, authorEmail: schema.user.email })
    .from(schema.wikiPageComment)
    .innerJoin(schema.user, eq(schema.user.id, schema.wikiPageComment.authorUserId))
    .where(eq(schema.wikiPageComment.pageId, pageId))
    .orderBy(asc(schema.wikiPageComment.createdAt));
  return rows.map((r) => ({ ...r.comment, authorName: r.authorName, authorEmail: r.authorEmail }));
}

export async function deleteComment(db: Db, input: { commentId: string; actor: { id: string; roles: Role[] } }): Promise<void> {
  const [comment] = await db.select().from(schema.wikiPageComment).where(eq(schema.wikiPageComment.id, input.commentId));
  if (!comment) throw new CommentNotFoundError();
  if (comment.authorUserId !== input.actor.id && !hasAnyRole(input.actor, ['admin', 'wiki-editor'])) throw new CommentForbiddenError();
  await db.delete(schema.wikiPageComment).where(eq(schema.wikiPageComment.id, input.commentId));
}
