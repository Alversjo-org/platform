import { describe, expect, it } from 'vitest';
import { daysLeft, endingSoon } from './renewals';

const now = new Date('2026-11-03T12:00:00Z');
const m = (id: string, active: boolean, expires: string | null) => ({ id, isActiveMember: active, membershipExpiresAt: expires ? new Date(expires) : null });

describe('endingSoon', () => {
  it('keeps active members ending within 30 days, soonest first', () => {
    const list = [m('later', true, '2026-11-30T00:00:00Z'), m('soon', true, '2026-11-05T00:00:00Z'), m('far', true, '2027-03-01T00:00:00Z'),
      m('lapsed', true, '2026-10-01T00:00:00Z'), m('inactive', false, '2026-11-10T00:00:00Z'), m('none', true, null)];
    expect(endingSoon(list, now).map((x) => x.id)).toEqual(['soon', 'later']);
  });
});

describe('daysLeft', () => {
  it('rounds up and never goes below zero', () => {
    expect(daysLeft(new Date('2026-11-05T00:00:00Z'), now)).toBe(2);
    expect(daysLeft(new Date('2026-10-01T00:00:00Z'), now)).toBe(0);
  });
});
