import type { User } from '@/db/schema';

/** True only when the member flag is set AND the expiry date is still in the future. */
export function isActiveNow(member: Pick<User, 'isActiveMember' | 'membershipExpiresAt'>): boolean {
  return member.isActiveMember && member.membershipExpiresAt !== null && member.membershipExpiresAt > new Date();
}

/** Payment buttons show whenever not an active member, or active but with no live recurring subscription. */
export function needsPayment(member: Pick<User, 'isActiveMember' | 'membershipExpiresAt' | 'stripeSubscriptionId'>): boolean {
  return !isActiveNow(member) || !member.stripeSubscriptionId;
}
