import Link from 'next/link';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { CheckboxSwitch } from '@/components/ui/checkbox-switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { Role, User } from '@/db/schema';
import { setUserRoleAction } from '@/app/roles/actions';
import { daysLeft } from '@/lib/members/renewals';
import { isActiveNow } from '@/lib/members/status';
import { ADMIN_ONLY_ROLES, GRANTABLE_ROLES, ROLE_LABELS } from '@/lib/roles/labels';
import { updateMemberAction } from './actions';

const ROLE_HINTS: Record<Role, string> = {
  admin: 'Everything, including boxes and roles.',
  'role-admin': 'Gives and takes roles.',
  'member-admin': 'Sees and edits members, like this page.',
  mapper: 'Draws and edits areas on the map.',
  treasurer: 'Keeps the budget, project groups and Fortnox link.',
  'wiki-editor': 'Edits the Land Manual.',
};

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');
const longDate = (d: Date) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Stockholm' }).format(d);
const label = 'text-xs font-semibold tracking-[0.08em] text-ink-soft uppercase';

/** Days left as a ring: a full ring is a year. */
function Ring({ fraction }: { fraction: number }) {
  const r = 40;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 96 96" className="size-[88px] shrink-0 -rotate-90" aria-hidden>
      <circle cx="48" cy="48" r={r} fill="none" stroke="rgb(30 36 32 / 0.12)" strokeWidth="8" />
      <circle cx="48" cy="48" r={r} fill="none" stroke="var(--forest)" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${c * fraction} ${c}`} />
    </svg>
  );
}

/** A member as a full page (`/members?edit=<id>`): membership on the left, access and roles on the right. */
export function MemberPage({ member, roles, canManageRoles, canChangeAdminRoles, error }: {
  member: User; roles: Role[]; canManageRoles: boolean; canChangeAdminRoles: boolean; error?: string;
}) {
  const now = new Date();
  const active = isActiveNow(member);
  const left = member.membershipExpiresAt ? daysLeft(member.membershipExpiresAt, now) : 0;
  const contact = [member.nickname, member.email, member.phoneNumber, member.discordHandle && `Discord ${member.discordHandle}`].filter(Boolean).join(' · ');
  const back = `/members?edit=${encodeURIComponent(member.id)}`;

  return (
    <>
      <Link href="/members" className="-mt-4 inline-block px-1 py-3 text-[15px] font-medium text-ink-soft">← Members</Link>
      <div className="mt-2 flex flex-wrap items-center gap-5">
        <Avatar image={member.image} name={member.name} email={member.email} className="size-20 bg-[#f2a37a] text-xl md:size-24" />
        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-[40px] leading-tight font-bold md:text-[56px]">{member.name || member.email}</h1>
          <p className="text-[15px] text-ink-soft">{contact}</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" size="lg" nativeButton={false} render={<Link href="/members" />}>Cancel</Button>
          <Button type="submit" form="member-form" size="lg">Save changes</Button>
        </div>
      </div>
      {error && <Alert variant="destructive" className="mt-4"><AlertDescription>{error}</AlertDescription></Alert>}

      <form id="member-form" action={updateMemberAction} className="mt-8 grid gap-6 md:grid-cols-[1fr_520px] md:items-start">
        <input type="hidden" name="id" value={member.id} />
        <div className="flex flex-col gap-6">
          <section className="glass flex flex-col gap-5 rounded-[32px] p-6 md:p-8">
            <h2 className={label}>Membership</h2>
            <div className="flex items-center gap-5">
              <Ring fraction={Math.min(1, left / 365)} />
              <div>
                <p className="font-serif text-2xl font-bold md:text-[28px]">
                  {active ? `Active until ${longDate(member.membershipExpiresAt!)}` : member.membershipExpiresAt ? `Ended ${longDate(member.membershipExpiresAt)}` : 'No membership yet'}
                </p>
                <p className="text-sm text-ink-soft">
                  {member.stripeSubscriptionId ? 'Paid through Stripe' : 'Set by hand'}{active ? ` · ${left} days left` : ''}
                </p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2"><Label htmlFor="membershipExpiresAt">Membership ends</Label><Input id="membershipExpiresAt" name="membershipExpiresAt" type="date" defaultValue={day(member.membershipExpiresAt)} /></div>
              <div className="flex flex-col gap-2"><Label htmlFor="lastContactedAt">Last contacted</Label><Input id="lastContactedAt" name="lastContactedAt" type="date" defaultValue={day(member.lastContactedAt)} /></div>
            </div>
            <div className="flex flex-col gap-2"><Label htmlFor="contactNotes">Notes</Label><Textarea id="contactNotes" name="contactNotes" rows={3} defaultValue={member.contactNotes ?? ''} /></div>
          </section>
          <section className="glass flex flex-col gap-4 rounded-[32px] p-6 md:p-8">
            <h2 className={label}>Contact</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2"><Label htmlFor="name">Name</Label><Input id="name" name="name" defaultValue={member.name} /></div>
              <div className="flex flex-col gap-2"><Label htmlFor="nickname">Nickname</Label><Input id="nickname" name="nickname" defaultValue={member.nickname ?? ''} /></div>
              <div className="flex flex-col gap-2"><Label htmlFor="phoneNumber">Phone number</Label><Input id="phoneNumber" name="phoneNumber" type="tel" placeholder="+46701234567" defaultValue={member.phoneNumber ?? ''} /></div>
              <div className="flex flex-col gap-2"><Label htmlFor="discordHandle">Discord handle</Label><Input id="discordHandle" name="discordHandle" defaultValue={member.discordHandle ?? ''} /></div>
            </div>
          </section>
        </div>

        <section className="glass flex flex-col gap-4 rounded-[32px] p-6 md:p-8">
          <h2 className={label}>Access</h2>
          <ToggleRow id="isActiveMember" title="Active member" hint="Counts as a member, whatever the payment says." defaultChecked={member.isActiveMember} />
          <ToggleRow id="canCreateEvents" title="Can create events" hint="Can draft and publish events." defaultChecked={member.canCreateEvents} />
          {canManageRoles && (
            <>
              <h2 className={`${label} mt-3`}>Roles</h2>
              <p className="-mt-2 text-xs text-ink-soft">Roles change straight away.</p>
              {GRANTABLE_ROLES.map((role) => {
                const held = roles.includes(role);
                const locked = ADMIN_ONLY_ROLES.includes(role) && !canChangeAdminRoles;
                return (
                  <div key={role} className="flex items-center gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-semibold">{ROLE_LABELS[role]}</p>
                      <p className="text-sm text-ink-soft">{ROLE_HINTS[role]}</p>
                    </div>
                    {/* Each role is its own form (the member form can't nest them), tied in by `form`. */}
                    <button
                      type="submit" form={`role-${role}`} role="switch" aria-checked={held} aria-label={ROLE_LABELS[role]} disabled={locked}
                      className={`relative h-7 w-11 shrink-0 rounded-full border border-ink/10 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${held ? 'bg-forest' : 'bg-ink/12'}`}
                    >
                      <span className={`absolute top-px left-px size-6 rounded-full bg-white shadow transition-transform ${held ? 'translate-x-4' : ''}`} />
                    </button>
                  </div>
                );
              })}
            </>
          )}
        </section>
      </form>
      {canManageRoles && GRANTABLE_ROLES.map((role) => (
        <form key={role} id={`role-${role}`} action={setUserRoleAction} hidden>
          <input type="hidden" name="userId" value={member.id} />
          <input type="hidden" name="role" value={role} />
          <input type="hidden" name="grant" value={roles.includes(role) ? 'false' : 'true'} />
          <input type="hidden" name="returnTo" value={back} />
        </form>
      ))}
    </>
  );
}

function ToggleRow({ id, title, hint, defaultChecked }: { id: string; title: string; hint: string; defaultChecked: boolean }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold">{title}</p>
        <p className="text-sm text-ink-soft">{hint}</p>
      </div>
      <CheckboxSwitch id={id} name={id} defaultChecked={defaultChecked} />
    </label>
  );
}
