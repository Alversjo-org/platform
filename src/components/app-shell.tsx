import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import type { SessionUser } from '@/lib/session';

export function AppShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="flex items-center justify-between">
        <Link href="/boxes" className="text-lg font-semibold">Alversjö</Link>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{user.email}</span>
          {user.role === 'admin' && <Badge>admin</Badge>}
        </div>
      </header>
      <Separator className="my-4" />
      <main>{children}</main>
    </div>
  );
}
