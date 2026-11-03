import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ParentSelect } from '@/components/wiki/parent-select';
import { getDb } from '@/db';
import { requireAnyRole } from '@/lib/session';
import { getPageTree } from '@/lib/wiki/page-service';
import { createPageAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function NewWikiPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireAnyRole(['admin', 'wiki-editor']);
  const { error } = await searchParams;
  const tree = await getPageTree(await getDb());
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">New wiki page</h1>
      {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}
      <form action={createPageAction} className="max-w-xl space-y-4">
        <div className="space-y-2"><Label htmlFor="title">Title</Label><Input id="title" name="title" required /></div>
        <div className="space-y-2"><Label>Parent page</Label><ParentSelect tree={tree} /></div>
        <Button type="submit">Create and edit</Button>
      </form>
    </div>
  );
}
