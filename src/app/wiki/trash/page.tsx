import { Button } from '@/components/ui/button';
import { getDb } from '@/db';
import { requireAnyRole } from '@/lib/session';
import { listDeletedPages } from '@/lib/wiki/page-service';
import { restorePageAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function WikiTrashPage() {
  await requireAnyRole(['admin', 'wiki-editor']);
  const pages = await listDeletedPages(await getDb());
  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">Trash</h1>
      <p className="mb-4 text-sm text-muted-foreground">Deleted pages keep their history and their address. Restoring puts a page back in the tree.</p>
      {pages.length === 0 ? (
        <p className="text-sm text-muted-foreground">No deleted pages.</p>
      ) : (
        <ul className="space-y-2">
          {pages.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
              <span>{p.title} <span className="text-muted-foreground">· deleted {p.updatedAt.toLocaleString()}</span></span>
              <form action={restorePageAction}>
                <input type="hidden" name="pageId" value={p.id} />
                <Button type="submit" size="sm" variant="outline">Restore</Button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
