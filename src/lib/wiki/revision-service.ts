import { and, desc, eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { WikiPage, WikiPageRevision } from '@/db/schema';
import { PageNotFoundError, updatePage } from './page-service';

export function listRevisions(db: Db, pageId: string): Promise<WikiPageRevision[]> {
  return db.select().from(schema.wikiPageRevision)
    .where(eq(schema.wikiPageRevision.pageId, pageId))
    .orderBy(desc(schema.wikiPageRevision.createdAt));
}

/** Restoring is a normal save of the old content, so it is version-locked and writes a new revision. */
export async function restoreRevision(
  db: Db,
  input: { pageId: string; revisionId: string; expectedVersion: number; editedByUserId: string },
): Promise<WikiPage> {
  const [revision] = await db.select().from(schema.wikiPageRevision)
    .where(and(eq(schema.wikiPageRevision.id, input.revisionId), eq(schema.wikiPageRevision.pageId, input.pageId)));
  if (!revision) throw new PageNotFoundError('Revision not found');
  return updatePage(db, {
    pageId: input.pageId,
    title: revision.title,
    content: revision.content,
    expectedVersion: input.expectedVersion,
    editedByUserId: input.editedByUserId,
  });
}
