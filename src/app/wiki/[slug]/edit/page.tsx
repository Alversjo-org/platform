import { notFound } from 'next/navigation';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BlockNoteEditor } from '@/components/wiki/block-note-editor';
import { ParentSelect } from '@/components/wiki/parent-select';
import { getDb } from '@/db';
import { requireAnyRole } from '@/lib/session';
import { getPageBySlug, getPageTree } from '@/lib/wiki/page-service';
import { deletePageAction, savePageAction } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function EditWikiPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string }> }) {
  await requireAnyRole(['admin', 'wiki-editor']);
  const [{ slug }, { error }] = await Promise.all([params, searchParams]);
  const db = await getDb();
  const page = await getPageBySlug(db, slug);
  if (!page) notFound();
  const tree = await getPageTree(db);

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Edit page</h1>
      {error === 'conflict' ? (
        <Alert variant="destructive" className="mb-4"><AlertDescription>This page changed while you were editing — reload to see the latest version.</AlertDescription></Alert>
      ) : error ? (
        <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>
      ) : null}
      <form action={savePageAction} className="space-y-4">
        <input type="hidden" name="pageId" value={page.id} />
        <input type="hidden" name="expectedVersion" value={page.version} />
        <div className="space-y-2"><Label htmlFor="title">Title</Label><Input id="title" name="title" defaultValue={page.title} required /></div>
        <div className="flex flex-wrap gap-4">
          <div className="space-y-2"><Label>Parent page</Label><ParentSelect tree={tree} value={page.parentId ?? ''} excludeId={page.id} /></div>
          <div className="space-y-2"><Label htmlFor="position">Position</Label><Input id="position" name="position" type="number" defaultValue={page.position} className="w-24" /></div>
        </div>
        <BlockNoteEditor initialContent={page.content} />
        <Button type="submit">Save</Button>
      </form>
      <form action={deletePageAction} className="mt-6">
        <input type="hidden" name="pageId" value={page.id} />
        <Button type="submit" variant="destructive" size="sm">Delete page</Button>
      </form>
    </div>
  );
}
