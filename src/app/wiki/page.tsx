import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import { requireUser } from '@/lib/session';
import { getPageTree } from '@/lib/wiki/page-service';

export const dynamic = 'force-dynamic';

export default async function WikiIndex() {
  await requireUser();
  const tree = await getPageTree(await getDb());
  if (tree.length > 0) redirect(`/wiki/${tree[0].slug}`);
  return <p className="text-sm text-muted-foreground">The wiki has no pages yet.</p>;
}
