import Link from 'next/link';
import { cn } from 'cn';

const TABS = [
  { href: '/budget', label: 'Budget' },
  { href: '/project-groups', label: 'Project groups' },
  { href: '/fortnox', label: 'Fortnox' },
] as const;

/** Budget, Project groups and Fortnox share one nav link; these tabs move between them. */
export function FinanceTabs({ active, dark = false }: { active: (typeof TABS)[number]['href']; dark?: boolean }) {
  return (
    <nav aria-label="Finance" className="glass inline-flex rounded-full p-1">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.href === active ? 'page' : undefined}
          className={cn('flex h-10 items-center rounded-full px-4 text-[15px] font-semibold',
            t.href === active ? (dark ? 'bg-sun text-ink' : 'bg-forest text-snow') : dark ? 'text-white' : 'text-ink')}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
