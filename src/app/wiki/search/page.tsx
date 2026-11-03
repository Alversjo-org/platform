import Link from 'next/link';
import { getDb } from '@/db';
import { requireUser } from '@/lib/session';
import { searchPages } from '@/lib/wiki/search';

export const dynamic = 'force-dynamic';

export default async function WikiSearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireUser();
  const q = ((await searchParams).q ?? '').trim();
  const results = q ? await searchPages(await getDb(), q) : [];
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Search</h1>
      {!q ? (
        <p className="text-sm text-muted-foreground">Type something in the search box.</p>
      ) : results.length === 0 ? (
        <p className="text-sm text-muted-foreground">No pages match “{q}”.</p>
      ) : (
        <ul className="space-y-2">
          {results.map((p) => <li key={p.id}><Link href={`/wiki/${p.slug}`} className="font-medium hover:underline">{p.title}</Link></li>)}
        </ul>
      )}
    </div>
  );
}
