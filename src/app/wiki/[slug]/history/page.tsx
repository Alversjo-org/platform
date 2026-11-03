import Link from 'next/link';
import { notFound } from 'next/navigation';
import { inArray } from 'drizzle-orm';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { getDb, schema } from '@/db';
import { hasAnyRole, requireUser } from '@/lib/session';
import { getPageBySlug } from '@/lib/wiki/page-service';
import { listRevisions } from '@/lib/wiki/revision-service';
import { restoreRevisionAction } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function WikiHistoryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ slug }, { error }] = await Promise.all([params, searchParams]);
  const db = await getDb();
  const page = await getPageBySlug(db, slug);
  if (!page) notFound();
  const user = await requireUser();
  const canRestore = hasAnyRole(user, ['admin', 'wiki-editor']);
  const revisions = await listRevisions(db, page.id);
  const editorIds = [...new Set(revisions.map((r) => r.editedByUserId))];
  const editors = editorIds.length ? await db.select({ id: schema.user.id, name: schema.user.name, email: schema.user.email }).from(schema.user).where(inArray(schema.user.id, editorIds)) : [];
  const who = (id: string) => { const u = editors.find((e) => e.id === id); return u ? u.name || u.email : 'Unknown'; };

  return (
    <div>
      <Link href={`/wiki/${page.slug}`} className="text-sm text-muted-foreground hover:text-foreground">← {page.title}</Link>
      <h1 className="mb-4 mt-2 text-xl font-semibold">History</h1>
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error === 'conflict' ? 'This page changed while you were looking — reload and try again.' : error}</AlertDescription>
        </Alert>
      )}
      <ul className="space-y-2">
        {revisions.map((r, i) => (
          <li key={r.id} className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
            <span>{r.title} <span className="text-muted-foreground">· {who(r.editedByUserId)} · {r.createdAt.toLocaleString()}{i === 0 ? ' · current' : ''}</span></span>
            {canRestore && i > 0 && (
              <form action={restoreRevisionAction}>
                <input type="hidden" name="pageId" value={page.id} />
                <input type="hidden" name="revisionId" value={r.id} />
                <input type="hidden" name="expectedVersion" value={page.version} />
                <Button type="submit" size="sm" variant="outline">Restore this version</Button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
