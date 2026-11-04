import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { getDb } from '@/db';
import { listPurchaseProjects } from '@/lib/projects/purchase-service';
import { requireUser } from '@/lib/session';
import { markFulfilledAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function WishlistPage() {
  const user = await requireUser();
  const items = await listPurchaseProjects(await getDb());
  return (
    <AppShell user={user}>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Wishlist</h1>
        <Button nativeButton={false} render={<Link href="/wishlist/new" />}>Add item</Button>
      </div>
      {items.length === 0 && <p className="text-sm text-muted-foreground">Nothing on the wishlist.</p>}
      <ul className="space-y-3">
        {items.map((p) => (
          <li key={p.id} className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div>
              <Link href={`/wishlist/${p.slug}`} className="font-medium hover:underline">{p.title}</Link>
              {p.summary && <p className="text-sm text-muted-foreground">{p.summary}</p>}
            </div>
            <form action={markFulfilledAction}>
              <input type="hidden" name="projectId" value={p.id} />
              <Button type="submit" size="sm" variant="outline">Got it</Button>
            </form>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
