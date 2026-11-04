import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { AskToEditButton } from '@/components/wiki/ask-to-edit-button';
import { BlockNoteReadOnly } from '@/components/wiki/block-note-view';
import { CommentThread } from '@/components/wiki/comment-thread';
import { getDb } from '@/db';
import { hasPendingRequest } from '@/lib/roles/request-service';
import { hasAnyRole, requireUser } from '@/lib/session';
import { getPageBySlug, getPageTree, type WikiPageTreeNode } from '@/lib/wiki/page-service';

export const dynamic = 'force-dynamic';

function pathTo(nodes: WikiPageTreeNode[], id: string, trail: WikiPageTreeNode[] = []): WikiPageTreeNode[] | null {
  for (const n of nodes) {
    if (n.id === id) return [...trail, n];
    const hit = pathTo(n.children, id, [...trail, n]);
    if (hit) return hit;
  }
  return null;
}

export default async function WikiPageView({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = await getDb();
  const page = await getPageBySlug(db, slug);
  if (!page) notFound();
  const user = await requireUser();
  const canEdit = hasAnyRole(user, ['admin', 'wiki-editor']);
  const crumbs = (pathTo(await getPageTree(db), page.id) ?? []).slice(0, -1);
  const pending = !canEdit ? await hasPendingRequest(db, { userId: user.id, role: 'wiki-editor' }) : false;

  return (
    <article>
      {crumbs.length > 0 && (
        <p className="mb-1 text-xs text-muted-foreground">
          {crumbs.map((c) => <span key={c.id}><Link href={`/wiki/${c.slug}`} className="hover:underline">{c.title}</Link> / </span>)}
        </p>
      )}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{page.title}</h1>
        <div className="flex items-center gap-2">
          <Button nativeButton={false} size="sm" variant="ghost" render={<Link href={`/wiki/${page.slug}/history`} />}>History</Button>
          {canEdit && <Button nativeButton={false} size="sm" render={<Link href={`/wiki/${page.slug}/edit`} />}>Edit</Button>}
          {!canEdit && <AskToEditButton pending={pending} returnTo={`/wiki/${page.slug}`} />}
        </div>
      </div>
      <BlockNoteReadOnly content={page.content} />
      <CommentThread pageId={page.id} slug={page.slug} user={user} />
    </article>
  );
}
