'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb, schema } from '@/db';
import type { Role } from '@/db/schema';
import { requireAnyRole, requireUser } from '@/lib/session';
import { addComment, CommentForbiddenError, CommentNotFoundError, deleteComment } from '@/lib/wiki/comment-service';
import {
  createPage, deletePage, InvalidMoveError, movePage, PageConflictError, PageHasChildrenError, PageNotFoundError, restorePage, updatePage,
} from '@/lib/wiki/page-service';
import { restoreRevision } from '@/lib/wiki/revision-service';

const safeSlug = (v: FormDataEntryValue | null) => encodeURIComponent(String(v ?? ''));

export async function addCommentAction(formData: FormData) {
  const actor = await requireUser();
  const body = String(formData.get('body') ?? '').trim();
  if (body) await addComment(await getDb(), { pageId: String(formData.get('pageId')), authorUserId: actor.id, body });
  revalidatePath(`/wiki/${safeSlug(formData.get('slug'))}`);
}

export async function deleteCommentAction(formData: FormData) {
  const actor = await requireUser();
  try {
    await deleteComment(await getDb(), { commentId: String(formData.get('commentId')), actor });
  } catch (e) {
    if (!(e instanceof CommentForbiddenError || e instanceof CommentNotFoundError)) throw e;
  }
  revalidatePath(`/wiki/${safeSlug(formData.get('slug'))}`);
}

// ---- Page writes (admin / wiki-editor) ----

const EDITORS: Role[] = ['admin', 'wiki-editor'];
const EMPTY_DOC = [{ type: 'paragraph', content: [] }];

function parseContent(raw: FormDataEntryValue | null): unknown[] | null {
  try {
    const v = JSON.parse(String(raw ?? ''));
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

async function slugOf(pageId: string): Promise<string | null> {
  const [row] = await (await getDb()).select({ slug: schema.wikiPage.slug }).from(schema.wikiPage).where(eq(schema.wikiPage.id, pageId));
  return row?.slug ?? null;
}

const withError = (path: string, error: string) => `${path}?error=${encodeURIComponent(error)}`;

export async function createPageAction(formData: FormData) {
  const actor = await requireAnyRole(EDITORS);
  const title = String(formData.get('title') ?? '').trim();
  if (!title) redirect(withError('/wiki/new', 'Give the page a title'));
  const parentId = String(formData.get('parentId') ?? '') || null;
  const page = await createPage(await getDb(), { title, content: EMPTY_DOC, parentId, createdByUserId: actor.id });
  revalidatePath('/wiki', 'layout');
  redirect(`/wiki/${page.slug}/edit`);
}

export async function savePageAction(formData: FormData) {
  const actor = await requireAnyRole(EDITORS);
  const db = await getDb();
  const pageId = String(formData.get('pageId'));
  const slug = await slugOf(pageId);
  if (!slug) redirect('/wiki');
  const editPath = `/wiki/${slug}/edit`;
  const title = String(formData.get('title') ?? '').trim();
  const content = parseContent(formData.get('content'));
  if (!title || !content) redirect(withError(editPath, 'The page needs a title and valid content'));

  try {
    await updatePage(db, { pageId, title, content, expectedVersion: Number(formData.get('expectedVersion')), editedByUserId: actor.id });
    const parentId = String(formData.get('parentId') ?? '') || null;
    const position = Number.parseInt(String(formData.get('position') ?? '0'), 10) || 0;
    await movePage(db, { pageId, parentId, position });
  } catch (e) {
    if (e instanceof PageConflictError) redirect(withError(editPath, 'conflict'));
    if (e instanceof InvalidMoveError) redirect(withError(editPath, e.message));
    throw e;
  }
  revalidatePath('/wiki', 'layout');
  redirect(`/wiki/${slug}`);
}

export async function deletePageAction(formData: FormData) {
  await requireAnyRole(EDITORS);
  const pageId = String(formData.get('pageId'));
  const slug = await slugOf(pageId);
  try {
    await deletePage(await getDb(), pageId);
  } catch (e) {
    if (e instanceof PageHasChildrenError && slug) redirect(withError(`/wiki/${slug}/edit`, e.message));
    throw e;
  }
  revalidatePath('/wiki', 'layout');
  redirect('/wiki');
}

export async function restorePageAction(formData: FormData) {
  await requireAnyRole(EDITORS);
  const page = await restorePage(await getDb(), String(formData.get('pageId')));
  revalidatePath('/wiki', 'layout');
  redirect(`/wiki/${page.slug}`);
}

export async function restoreRevisionAction(formData: FormData) {
  const actor = await requireAnyRole(EDITORS);
  const pageId = String(formData.get('pageId'));
  const slug = await slugOf(pageId);
  if (!slug) redirect('/wiki');
  try {
    await restoreRevision(await getDb(), {
      pageId,
      revisionId: String(formData.get('revisionId')),
      expectedVersion: Number(formData.get('expectedVersion')),
      editedByUserId: actor.id,
    });
  } catch (e) {
    if (e instanceof PageConflictError) redirect(withError(`/wiki/${slug}/history`, 'conflict'));
    if (e instanceof PageNotFoundError) redirect(withError(`/wiki/${slug}/history`, 'That version no longer exists'));
    throw e;
  }
  revalidatePath('/wiki', 'layout');
  redirect(`/wiki/${slug}`);
}
