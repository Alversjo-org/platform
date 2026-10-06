import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { isMemberAdmin, type SessionUser } from '@/lib/session';

export function AppShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-lg font-semibold">Alversjö</Link>
          <Link href="/boxes" className="text-sm text-muted-foreground hover:text-foreground">Boxes</Link>
          {isMemberAdmin(user) && <Link href="/members" className="text-sm text-muted-foreground hover:text-foreground">Members</Link>}
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{user.email}</span>
          {user.role !== 'member' && <Badge>{user.role}</Badge>}
        </div>
      </header>
      <Separator className="my-4" />
      <main>{children}</main>
    </div>
  );
}
