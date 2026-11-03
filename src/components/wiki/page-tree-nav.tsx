import Link from 'next/link';
import type { WikiPageTreeNode } from '@/lib/wiki/page-service';

function Branch({ nodes }: { nodes: WikiPageTreeNode[] }) {
  return (
    <ul className="space-y-1 pl-3 first:pl-0">
      {nodes.map((n) => (
        <li key={n.id}>
          <Link href={`/wiki/${n.slug}`} className="text-sm hover:underline">{n.title}</Link>
          {n.children.length > 0 && <Branch nodes={n.children} />}
        </li>
      ))}
    </ul>
  );
}

export function PageTreeNav({ tree }: { tree: WikiPageTreeNode[] }) {
  return (
    <nav aria-label="Wiki pages" className="space-y-3">
      <form action="/wiki/search" method="get" className="flex gap-1">
        <input name="q" type="search" placeholder="Search the wiki" aria-label="Search the wiki" className="h-8 w-full min-w-0 rounded-md border bg-background px-2 text-sm" />
      </form>
      <Link href="/wiki/new" className="block text-sm text-muted-foreground hover:text-foreground">+ New page</Link>
      {tree.length === 0 ? <p className="text-sm text-muted-foreground">No pages yet.</p> : <Branch nodes={tree} />}
    </nav>
  );
}
