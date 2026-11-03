import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { getDb } from '@/db';
import { hasAnyRole, type SessionUser } from '@/lib/session';
import { listComments } from '@/lib/wiki/comment-service';
import { addCommentAction, deleteCommentAction } from '@/app/wiki/actions';

export async function CommentThread({ pageId, slug, user }: { pageId: string; slug: string; user: SessionUser | null }) {
  const comments = await listComments(await getDb(), pageId);
  const moderator = user ? hasAnyRole(user, ['admin', 'wiki-editor']) : false;
  return (
    <section className="mt-8 space-y-3" aria-label="Comments">
      <h2 className="text-lg font-medium">Comments</h2>
      {comments.length === 0 && <p className="text-sm text-muted-foreground">No comments yet.</p>}
      {comments.map((c) => (
        <div key={c.id} className="rounded-md border p-3 text-sm">
          <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>{c.authorName || c.authorEmail} · {c.createdAt.toLocaleString()}</span>
            {user && (user.id === c.authorUserId || moderator) && (
              <form action={deleteCommentAction}>
                <input type="hidden" name="commentId" value={c.id} />
                <input type="hidden" name="slug" value={slug} />
                <Button type="submit" size="sm" variant="ghost">Delete</Button>
              </form>
            )}
          </div>
          <p className="whitespace-pre-wrap">{c.body}</p>
        </div>
      ))}
      {user ? (
        <form action={addCommentAction} className="space-y-2">
          <input type="hidden" name="pageId" value={pageId} />
          <input type="hidden" name="slug" value={slug} />
          <Textarea name="body" required rows={3} placeholder="Add a comment" />
          <Button type="submit" size="sm">Comment</Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground"><Link href="/login" className="underline">Log in</Link> to comment.</p>
      )}
    </section>
  );
}
