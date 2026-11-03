'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db';
import { requireUser } from '@/lib/session';
import { addComment, CommentForbiddenError, CommentNotFoundError, deleteComment } from '@/lib/wiki/comment-service';

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
