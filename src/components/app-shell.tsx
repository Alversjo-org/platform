import { eq } from 'drizzle-orm';
import Image from 'next/image';
import Link from 'next/link';
import { signOutAction } from '@/app/actions';
import { getDb, schema } from '@/db';
import { DesktopNavLinks, TabBar, type NavItem } from '@/components/nav-links';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from 'cn';
import { ROLE_LABELS } from '@/lib/roles/labels';
import { hasAnyRole, isMemberAdmin, isTreasurer, type SessionUser } from '@/lib/session';

export async function loadProfile(userId: string) {
  const db = await getDb();
  const [profile] = await db
    .select({ name: schema.user.name, nickname: schema.user.nickname, image: schema.user.image })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  return { name: profile?.name ?? '', nickname: profile?.nickname ?? null, image: profile?.image ?? null };
}

/** Desktop nav links, gated by role as before. Budget stands for all three finance pages. */
export function desktopNavItems(user: SessionUser): NavItem[] {
  return [
    { href: '/events', label: 'Events' },
    { href: '/map', label: 'Map' },
    { href: '/boxes', label: 'Boxes' },
    { href: '/expenses', label: 'Outlays' },
    ...(isMemberAdmin(user) ? [{ href: '/members', label: 'Members' }] : []),
    ...(hasAnyRole(user, ['admin', 'mapper']) ? [{ href: '/areas', label: 'Areas' }] : []),
    ...(hasAnyRole(user, ['admin', 'role-admin']) ? [{ href: '/roles', label: 'Roles' }] : []),
    ...(isTreasurer(user) ? [{ href: '/budget', label: 'Budget', also: ['/project-groups', '/fortnox'] }] : []),
  ];
}

const TABS: NavItem[] = [
  { href: '/', label: 'Home' },
  { href: '/events', label: 'Events' },
  { href: '/map', label: 'Map' },
  { href: '/more', label: 'More' },
];

/**
 * The page frame: a backdrop (photo and wash, or plain snow), the floating glass nav on
 * desktop and the tab bar on phones. `theme="dark"` turns the page's tokens to the night
 * palette, whatever the system setting.
 */
export async function AppShell({ user, children, theme = 'light', backdrop, className, tabBar = true }: {
  user: SessionUser;
  children: React.ReactNode;
  theme?: 'light' | 'dark';
  backdrop?: React.ReactNode;
  className?: string;
  /** Off for pages with their own bottom bar on phones (the event page's Sign up). */
  tabBar?: boolean;
}) {
  const { name, nickname, image } = await loadProfile(user.id);
  const displayName = nickname || name || user.email;

  return (
    <div className={cn('relative flex min-h-svh flex-col text-foreground', theme === 'dark' && 'dark')}>
      {backdrop}
      <header className="sticky top-7 z-40 mx-auto mt-7 hidden w-full max-w-[1440px] px-10 md:block">
        <div className="glass flex h-[68px] items-center gap-1 rounded-full p-3">
          <Link href="/" className="flex shrink-0 items-center gap-2.5 pr-[18px]">
            <Image src="/alversjo-logo.png" alt="" width={44} height={44} className="size-11" />
            <span className="font-serif text-[22px] font-bold">Alversjö</span>
          </Link>
          <DesktopNavLinks items={desktopNavItems(user)} />
          <div className="flex-1" />
          <DropdownMenu>
            <DropdownMenuTrigger aria-label="Account menu" className="shrink-0 rounded-full">
              <Avatar image={image} name={name} email={user.email} className="size-11 text-sm font-semibold" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <div className="flex items-center gap-2 px-1.5 py-1.5">
                <Avatar image={image} name={name} email={user.email} className="size-10 text-sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{displayName}</p>
                  <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                </div>
              </div>
              {user.roles.length > 0 && (
                <div className="flex flex-wrap gap-1 px-1.5 py-1">
                  {user.roles.map((r) => <Badge key={r}>{ROLE_LABELS[r]}</Badge>)}
                </div>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem render={<Link href="/profile" />}>Edit profile</DropdownMenuItem>
              <DropdownMenuItem nativeButton render={<button type="submit" form="sign-out" />} className="w-full">Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* The menu renders in a portal, so its Sign out item submits this form by id. */}
          <form id="sign-out" action={signOutAction} hidden />
        </div>
      </header>
      <main className={cn('mx-auto w-full max-w-[1440px] flex-1 px-4 pt-14 pb-28 md:px-10 md:pt-11 md:pb-16', className)}>
        {children}
      </main>
      {tabBar && <TabBar items={TABS} />}
    </div>
  );
}
