import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { getDb } from '@/db';
import { getProjectBySlug } from '@/lib/projects/service';
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function WishlistItemPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await requireUser();
  const { slug } = await params;
  const project = await getProjectBySlug(await getDb(), slug);
  if (!project || project.kind !== 'purchase') notFound();
  return (
    <AppShell user={user}>
      <Link href="/wishlist" className="text-sm text-muted-foreground hover:text-foreground">← Wishlist</Link>
      <h1 className="mt-2 text-xl font-semibold">{project.title}</h1>
      {project.status === 'closed' && <p className="text-sm text-muted-foreground">Fulfilled</p>}
      {project.summary && <p className="mt-2">{project.summary}</p>}
      {project.body && <p className="mt-4 whitespace-pre-wrap">{project.body}</p>}
    </AppShell>
  );
}
