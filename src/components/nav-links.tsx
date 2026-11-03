'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from 'cn';

export type NavItem = { href: string; label: string; also?: string[] };

function isActive(pathname: string, item: NavItem): boolean {
  return [item.href, ...(item.also ?? [])].some((h) => (h === '/' ? pathname === '/' : pathname === h || pathname.startsWith(`${h}/`)));
}

/** The links inside the desktop nav pill. */
export function DesktopNavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex min-w-0 items-center gap-1 overflow-x-auto">
      {items.map((item) => {
        const active = isActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-full px-4 py-3 text-[15px] font-medium whitespace-nowrap text-foreground/80 transition-colors hover:bg-accent hover:text-foreground',
              active && 'bg-accent text-foreground',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** The phone tab bar. Pages that aren't a tab of their own light up More. */
export function TabBar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const activeTab = items.find((i) => i.href !== '/more' && isActive(pathname, i))?.href ?? '/more';
  return (
    <nav
      aria-label="Main"
      className="glass fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 flex h-16 items-center gap-0.5 rounded-full p-1 md:hidden"
    >
      {items.map((item) => {
        const active = item.href === activeTab;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex h-14 flex-1 items-center justify-center rounded-full text-sm text-foreground/80',
              active && 'bg-accent font-semibold text-foreground',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
