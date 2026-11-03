import { AppShell } from '@/components/app-shell';
import { PageTreeNav } from '@/components/wiki/page-tree-nav';
import { getDb } from '@/db';
import { getSessionUser } from '@/lib/session';
import { getPageTree } from '@/lib/wiki/page-service';

export const dynamic = 'force-dynamic';

// No auth gate: every wiki page is publicly readable. Write paths gate themselves.
export default async function WikiLayout({ children }: { children: React.ReactNode }) {
  const [user, tree] = await Promise.all([getSessionUser(), getDb().then(getPageTree)]);
  return (
    <AppShell user={user}>
      <div className="grid gap-6 md:grid-cols-[14rem_1fr]">
        <aside><PageTreeNav tree={tree} /></aside>
        <div className="min-w-0">{children}</div>
      </div>
    </AppShell>
  );
}
