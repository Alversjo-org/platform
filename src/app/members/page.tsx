import Link from 'next/link';
import { getDb } from '@/db';
import { AppShell } from '@/components/app-shell';
import { Backdrop } from '@/components/backdrop';
import { AVATAR_TINTS, Pill } from '@/components/pill';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { resolveDialogTarget } from '@/lib/members/dialog-target';
import { matchesQuery } from '@/lib/members/filter';
import { endingSoon } from '@/lib/members/renewals';
import { listMembers } from '@/lib/members/service';
import { ROLE_LABELS } from '@/lib/roles/labels';
import { groupRolesByUserId, listUserRoles } from '@/lib/roles/service';
import { hasAnyRole, requireMemberAdmin } from '@/lib/session';
import { cn } from 'cn';
import { syncFromStripeAction } from './actions';
import { AskRenewals } from './ask-renewals';
import { MemberPage } from './member-page';
import { MemberSearch } from './member-search';

export const dynamic = 'force-dynamic';

type Status = 'active' | 'inactive' | 'all';
const STATUS_TABS: { value: Status; label: string }[] = [
  { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'all', label: 'All' },
];

const short = (d: Date) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/Stockholm' }).format(d);
const medium = (d: Date) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Stockholm' }).format(d);

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{
    synced?: string; created?: string; matched?: string; error?: string;
    status?: string; edit?: string; roles?: string; q?: string; asked?: string;
  }>;
}) {
  const admin = await requireMemberAdmin();
  const db = await getDb();
  const allMembers = await listMembers(db);
  const rolesByUserId = groupRolesByUserId(await listUserRoles(db));
  const canManageRoles = hasAnyRole(admin, ['admin', 'role-admin']);
  const canChangeAdminRoles = hasAnyRole(admin, ['admin']);
  const { synced, created, matched, error, edit, roles, q, asked, status: statusRaw } = await searchParams;
  const backdrop = <Backdrop photo="winterSun" blur={14} wash="rgb(246 244 238 / 0.45)" />;

  // ?edit= (and the old ?roles=) show one member as a full page; resolved from the unfiltered
  // list so it works whatever status tab the link came from.
  const target = resolveDialogTarget(allMembers, { edit, roles });
  if (target) {
    return (
      <AppShell user={admin} backdrop={backdrop}>
        <div className="md:px-10"><MemberPage member={target} roles={rolesByUserId.get(target.id) ?? []} canManageRoles={canManageRoles} canChangeAdminRoles={canChangeAdminRoles} error={error} /></div>
      </AppShell>
    );
  }

  const status: Status = statusRaw === 'inactive' || statusRaw === 'all' ? statusRaw : 'active';
  const members = allMembers
    .filter((m) => (status === 'all' ? true : status === 'active' ? m.isActiveMember : !m.isActiveMember))
    .filter((m) => matchesQuery(m, q ?? ''));
  const activeCount = allMembers.filter((m) => m.isActiveMember).length;
  const counts: Record<Status, number> = { active: activeCount, inactive: allMembers.length - activeCount, all: allMembers.length };
  const now = new Date();
  const due = endingSoon(allMembers, now);
  const dueIds = new Set(due.map((m) => m.id));

  return (
    <AppShell user={admin} backdrop={backdrop}>
      <div className="flex flex-wrap items-start gap-4 md:px-10">
        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-[44px] leading-none font-bold md:text-[64px]">Members</h1>
          <p className="mt-3 text-[17px] text-ink-soft">{allMembers.length} people, {activeCount} with an active membership.</p>
        </div>
        <div className="flex flex-wrap gap-3 md:mt-3">
          <Button variant="outline" className="md:h-12 md:px-6 md:text-base" nativeButton={false} render={<Link href="/members/settings" />}>Edit renewal message</Button>
          <Button variant="outline" className="md:h-12 md:px-6 md:text-base" nativeButton={false} render={<Link href="/members/import" />}>Import CSV</Button>
          <form action={syncFromStripeAction}><Button type="submit" variant="outline" className="md:h-12 md:px-6 md:text-base">Sync from Stripe</Button></form>
        </div>
      </div>

      {(synced !== undefined || asked !== undefined) && (
        <Alert className="mt-4 md:mx-10">
          <AlertDescription>
            {synced !== undefined && `Stripe sync: ${created ?? 0} created, ${matched ?? 0} matched, ${error ?? 0} errored.`}
            {asked !== undefined && `Asked ${asked} ${asked === '1' ? 'member' : 'members'} to renew.`}
          </AlertDescription>
        </Alert>
      )}

      <div className="mt-6 grid gap-6 md:mt-8 md:grid-cols-[1fr_380px] md:items-start md:px-10">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <nav aria-label="Status" className="glass flex shrink-0 rounded-full p-1">
              {STATUS_TABS.map((tab) => (
                <Link key={tab.value} href={`/members?status=${tab.value}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
                  aria-current={status === tab.value ? 'page' : undefined}
                  className={cn('flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full px-4 text-[15px] font-semibold', status === tab.value ? 'bg-forest text-snow' : 'text-ink')}>
                  {tab.label} <span className="font-normal opacity-70">{counts[tab.value]}</span>
                </Link>
              ))}
            </nav>
            <MemberSearch status={status} initialQuery={q ?? ''} />
          </div>

          <ul className="glass flex flex-col rounded-[32px] p-2">
            {members.length === 0 && <li className="p-6 text-ink-soft">No one matches.</li>}
            {members.map((m, i) => {
              const memberRoles = rolesByUserId.get(m.id) ?? [];
              const tone = !m.isActiveMember ? 'muted' : dueIds.has(m.id) ? 'sun' : 'good';
              return (
                <li key={m.id}>
                  <Link href={`/members?edit=${encodeURIComponent(m.id)}`} className="flex items-center gap-4 rounded-[22px] p-3 transition-colors hover:bg-white/70">
                    <Avatar image={m.image} name={m.name} email={m.email} className={cn('size-11 text-sm', AVATAR_TINTS[i % AVATAR_TINTS.length])} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-semibold">{m.name || m.email}{m.nickname ? ` · ${m.nickname}` : ''}</p>
                      <p className="truncate text-sm text-ink-soft">{m.email}</p>
                    </div>
                    <div className="hidden w-40 flex-wrap gap-1 lg:flex">
                      {memberRoles.slice(0, 2).map((r) => <Pill key={r}>{ROLE_LABELS[r]}</Pill>)}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Pill tone={tone}>{!m.isActiveMember ? 'Inactive' : dueIds.has(m.id) ? 'Ends soon' : 'Active'}</Pill>
                      {m.membershipExpiresAt && <span className="hidden text-xs text-ink-soft tabular sm:inline">until {medium(m.membershipExpiresAt)}</span>}
                    </div>
                    <span aria-hidden className="hidden text-xl text-ink-soft sm:inline">→</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        <aside className="glass flex flex-col gap-4 rounded-[32px] p-6 md:p-7">
          <h2 className="text-xs font-semibold tracking-[0.08em] text-ink-soft uppercase">Renewals</h2>
          <p className="font-serif text-[26px] leading-tight font-bold">
            {due.length === 0 ? 'No memberships end in the next 30 days' : `${due.length} ${due.length === 1 ? 'membership ends' : 'memberships end'} in the next 30 days`}
          </p>
          {due.map((m, i) => (
            <Link key={m.id} href={`/members?edit=${encodeURIComponent(m.id)}`} className="flex items-center gap-3">
              <Avatar image={m.image} name={m.name} email={m.email} className={cn('size-9 text-xs', AVATAR_TINTS[(i + 1) % AVATAR_TINTS.length])} />
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold">{m.name || m.email}</p>
                <p className="truncate text-sm text-ink-soft">Ends {short(m.membershipExpiresAt!)} · {m.lastContactedAt ? `Asked ${short(m.lastContactedAt)}` : 'Not contacted yet'}</p>
              </div>
            </Link>
          ))}
          {due.length > 0 && <AskRenewals count={due.length} />}
        </aside>
      </div>
    </AppShell>
  );
}
