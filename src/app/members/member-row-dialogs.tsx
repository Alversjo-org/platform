'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { Role, User } from '@/db/schema';
import { setUserRoleAction } from '@/app/roles/actions';
import { GRANTABLE_ROLES, ROLE_LABELS } from '@/lib/roles/labels';
import { updateMemberAction } from './actions';

const ADMIN_ONLY_ROLES: Role[] = ['admin', 'role-admin'];

export function MemberRowDialogs(props: {
  member: User;
  memberRoles: Role[];
  canManageRoles: boolean;
  canChangeAdminRoles: boolean;
  openEdit: boolean;
  openRoles: boolean;
  error?: string;
}) {
  const { member, memberRoles, canManageRoles, canChangeAdminRoles, openEdit, openRoles, error } = props;
  const router = useRouter();
  const closeOnOutsideOrEscape = (open: boolean) => { if (!open) router.push('/members'); };

  return (
    <>
      <Link href={`/members?edit=${member.id}`} className="underline">{member.name || member.nickname || '—'}</Link>
      {canManageRoles && (
        <Link href={`/members?roles=${member.id}`} className="ml-2 text-sm underline">Roles</Link>
      )}

      <Dialog open={openEdit} onOpenChange={closeOnOutsideOrEscape}>
        <DialogPopup>
          <DialogTitle>{member.name || member.email}</DialogTitle>
          {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}
          <form action={updateMemberAction} className="space-y-4">
            <input type="hidden" name="id" value={member.id} />
            <div className="space-y-2"><Label htmlFor="name">Name</Label><Input id="name" name="name" defaultValue={member.name} /></div>
            <div className="space-y-2"><Label htmlFor="nickname">Nickname</Label><Input id="nickname" name="nickname" defaultValue={member.nickname ?? ''} /></div>
            <div className="space-y-2"><Label htmlFor="phoneNumber">Phone number</Label><Input id="phoneNumber" name="phoneNumber" type="tel" placeholder="+46701234567" defaultValue={member.phoneNumber ?? ''} /></div>
            <div className="space-y-2"><Label htmlFor="discordHandle">Discord handle</Label><Input id="discordHandle" name="discordHandle" defaultValue={member.discordHandle ?? ''} /></div>
            <div className="flex items-center gap-2"><Checkbox id="isActiveMember" name="isActiveMember" defaultChecked={member.isActiveMember} /><Label htmlFor="isActiveMember">Active member</Label></div>
            <div className="flex items-center gap-2"><Checkbox id="canCreateEvents" name="canCreateEvents" defaultChecked={member.canCreateEvents} /><Label htmlFor="canCreateEvents">Can create events</Label></div>
            <div className="space-y-2">
              <Label htmlFor="membershipExpiresAt">Membership expires</Label>
              <Input id="membershipExpiresAt" name="membershipExpiresAt" type="date" defaultValue={member.membershipExpiresAt ? member.membershipExpiresAt.toISOString().slice(0, 10) : ''} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastContactedAt">Last contacted</Label>
              <Input id="lastContactedAt" name="lastContactedAt" type="date" defaultValue={member.lastContactedAt ? member.lastContactedAt.toISOString().slice(0, 10) : ''} />
            </div>
            <div className="space-y-2"><Label htmlFor="contactNotes">Notes</Label><Textarea id="contactNotes" name="contactNotes" defaultValue={member.contactNotes ?? ''} /></div>
            <div className="flex justify-end gap-2">
              <Button render={<Link href="/members" />} variant="outline">Cancel</Button>
              <Button type="submit">Save</Button>
            </div>
          </form>
        </DialogPopup>
      </Dialog>

      {canManageRoles && (
        <Dialog open={openRoles} onOpenChange={closeOnOutsideOrEscape}>
          <DialogPopup>
            <DialogTitle>Roles for {member.name || member.email}</DialogTitle>
            <div className="flex flex-wrap gap-2">
              {GRANTABLE_ROLES.map((role) => {
                const held = memberRoles.includes(role);
                if (ADMIN_ONLY_ROLES.includes(role) && !canChangeAdminRoles) {
                  return (
                    <span key={role} className="rounded-full border border-dashed px-3 py-1 text-sm text-muted-foreground">
                      {ROLE_LABELS[role]}
                    </span>
                  );
                }
                return (
                  <form key={role} action={setUserRoleAction}>
                    <input type="hidden" name="userId" value={member.id} />
                    <input type="hidden" name="role" value={role} />
                    <input type="hidden" name="grant" value={held ? 'false' : 'true'} />
                    <input type="hidden" name="returnTo" value={`/members?roles=${member.id}`} />
                    <Button type="submit" size="sm" variant={held ? 'default' : 'outline'} className="rounded-full">
                      {held ? '✓ ' : ''}{ROLE_LABELS[role]}
                    </Button>
                  </form>
                );
              })}
            </div>
            <div className="mt-4 flex justify-end">
              <Button render={<Link href="/members" />} variant="outline">Close</Button>
            </div>
          </DialogPopup>
        </Dialog>
      )}
    </>
  );
}
