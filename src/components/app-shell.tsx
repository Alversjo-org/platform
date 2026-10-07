import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { getDb, schema } from '@/db';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { isMemberAdmin, type SessionUser } from '@/lib/session';

export async function AppShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const db = await getDb();
  const [profile] = await db
    .select({ name: schema.user.name, nickname: schema.user.nickname, image: schema.user.image })
    .from(schema.user)
    .where(eq(schema.user.id, user.id));
  const name = profile?.name ?? '';
  const image = profile?.image ?? null;
  const displayName = profile?.nickname || name || user.email;

  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="space-y-2">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-lg font-semibold">Alversjö</Link>
          <DropdownMenu>
            <DropdownMenuTrigger aria-label="Account menu" className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              <Avatar image={image} name={name} email={user.email} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <div className="flex items-center gap-2 px-1.5 py-1.5">
                <Avatar image={image} name={name} email={user.email} className="size-10 text-sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{displayName}</p>
                  <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                </div>
              </div>
              {user.role !== 'member' && <div className="px-1.5 py-1"><Badge>{user.role}</Badge></div>}
              <DropdownMenuSeparator />
              <DropdownMenuItem render={<Link href="/profile" />}>Edit profile</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <nav className="flex items-center gap-4">
          <Link href="/boxes" className="text-sm text-muted-foreground hover:text-foreground">Boxes</Link>
          {isMemberAdmin(user) && <Link href="/members" className="text-sm text-muted-foreground hover:text-foreground">Members</Link>}
        </nav>
      </header>
      <Separator className="my-4" />
      <main>{children}</main>
    </div>
  );
}
