import { AppShell } from '@/components/app-shell';
import { PageTreeNav } from '@/components/wiki/page-tree-nav';
import { getDb } from '@/db';
import { hasAnyRole, requireUser } from '@/lib/session';
import { getPageTree } from '@/lib/wiki/page-service';

export const dynamic = 'force-dynamic';

// Members only: the proxy sends logged-out visitors to /login, and requireUser backs that up.
export default async function WikiLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const tree = await getPageTree(await getDb());
  const canEdit = hasAnyRole(user, ['admin', 'wiki-editor']);
  return (
    <AppShell user={user}>
      <div className="grid gap-6 md:grid-cols-[14rem_1fr]">
        <aside><PageTreeNav tree={tree} canEdit={canEdit} /></aside>
        <div className="min-w-0">{children}</div>
      </div>
    </AppShell>
  );
}
