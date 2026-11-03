import type { User } from '@/db/schema';

const DAY = 24 * 60 * 60 * 1000;

/** Active members whose membership ends within the next `days` days, soonest first. */
export function endingSoon<T extends Pick<User, 'isActiveMember' | 'membershipExpiresAt'>>(members: T[], now: Date, days = 30): T[] {
  const until = now.getTime() + days * DAY;
  return members
    .filter((m) => m.isActiveMember && m.membershipExpiresAt !== null && m.membershipExpiresAt.getTime() >= now.getTime() && m.membershipExpiresAt.getTime() <= until)
    .sort((a, b) => a.membershipExpiresAt!.getTime() - b.membershipExpiresAt!.getTime());
}

/** Whole days from `now` until `date` (0 when it has passed). */
export function daysLeft(date: Date, now: Date): number {
  return Math.max(0, Math.ceil((date.getTime() - now.getTime()) / DAY));
}
