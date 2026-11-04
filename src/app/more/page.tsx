import Link from 'next/link';
import { signOutAction } from '@/app/actions';
import { AppShell, loadProfile } from '@/components/app-shell';
import { Avatar } from '@/components/ui/avatar';
import { ROLE_LABELS } from '@/lib/roles/labels';
import { hasAnyRole, isMemberAdmin, isTreasurer, requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

type Row = { href: string; label: string; hint: string };

function Group({ title, rows }: { title: string; rows: Row[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold tracking-[0.08em] text-ink-soft uppercase">{title}</h2>
      <div className="flex flex-col rounded-[28px] bg-white/75 py-2 shadow-[0_4px_24px_rgb(0_0_0/0.06)]">
        {rows.map((r) => (
          <Link key={r.href} href={r.href} className="flex min-h-12 items-center gap-3 px-[18px] py-3">
            <span className="text-base font-semibold text-ink">{r.label}</span>
            <span className="ml-auto truncate text-sm text-ink-soft">{r.hint}</span>
            <span aria-hidden className="text-ink-soft">›</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** Everything that isn't a tab, for phones. Each link shows only to those who can use it. */
export default async function MorePage() {
  const user = await requireUser();
  const { name, nickname, image } = await loadProfile(user.id);
  const roles = user.roles.map((r) => ROLE_LABELS[r]).join(' · ');

  return (
    <AppShell user={user} backdrop={<div aria-hidden className="fixed inset-0 -z-10 bg-[#f3efe6]" />}>
      <div className="mx-auto flex max-w-xl flex-col gap-6">
        <div className="flex items-center gap-4">
          <Avatar image={image} name={name} email={user.email} className="size-14 text-base" />
          <div className="min-w-0">
            <h1 className="truncate font-serif text-[28px] leading-tight font-bold">{nickname || name || user.email}</h1>
            <p className="truncate text-sm text-ink-soft">{roles || user.email}</p>
          </div>
        </div>
        <Group title="You" rows={[
          { href: '/profile', label: 'Edit profile', hint: 'Name, photo, phone' },
          { href: '/expenses', label: 'Outlays', hint: 'Get paid back' },
          { href: '/boxes', label: 'Boxes', hint: 'Your cloud dev boxes' },
        ]} />
        <Group title="Together" rows={[
          { href: '/wiki', label: 'Wiki', hint: 'The land manual' },
          { href: '/tasks', label: 'Tasks', hint: 'What needs doing' },
          { href: '/wishlist', label: 'Wishlist', hint: 'Stuff we want to buy' },
        ]} />
        <Group title="Run the land" rows={[
          ...(isMemberAdmin(user) ? [{ href: '/members', label: 'Members', hint: 'Who is a member' }] : []),
          ...(hasAnyRole(user, ['admin', 'mapper']) ? [{ href: '/areas', label: 'Areas', hint: 'Draw them on the map' }] : []),
          ...(hasAnyRole(user, ['admin', 'role-admin']) ? [{ href: '/roles', label: 'Roles', hint: 'Who can do what' }] : []),
        ]} />
        <Group title="Money" rows={isTreasurer(user) ? [
          { href: '/budget', label: 'Budget', hint: 'The year’s plan' },
          { href: '/project-groups', label: 'Project groups', hint: 'Cost centres' },
          { href: '/fortnox', label: 'Fortnox', hint: 'Bookkeeping link' },
        ] : []} />
        <form action={signOutAction}>
          <button type="submit" className="min-h-12 w-full rounded-full border border-ghost-border bg-ghost px-5 text-[15px] font-semibold text-ink">
            Sign out
          </button>
        </form>
      </div>
    </AppShell>
  );
}
