import { describe, expect, it } from 'vitest';
import { isActiveNow, needsPayment } from './status';

const future = new Date(Date.now() + 86_400_000);
const past = new Date(Date.now() - 86_400_000);

describe('isActiveNow', () => {
  it('is false when isActiveMember is true but the expiry date has passed', () => {
    expect(isActiveNow({ isActiveMember: true, membershipExpiresAt: past })).toBe(false);
  });

  it('is true when active and the expiry date is in the future', () => {
    expect(isActiveNow({ isActiveMember: true, membershipExpiresAt: future })).toBe(true);
  });

  it('is false with no expiry date at all', () => {
    expect(isActiveNow({ isActiveMember: true, membershipExpiresAt: null })).toBe(false);
  });
});

describe('needsPayment', () => {
  it('is true for an expired member even with a stripeSubscriptionId on file', () => {
    expect(needsPayment({ isActiveMember: true, membershipExpiresAt: past, stripeSubscriptionId: 'sub_1' })).toBe(true);
  });

  it('is true for an active member with no recurring subscription (manual grant or one-time payment)', () => {
    expect(needsPayment({ isActiveMember: true, membershipExpiresAt: future, stripeSubscriptionId: null })).toBe(true);
  });

  it('is false for an active member on a live subscription', () => {
    expect(needsPayment({ isActiveMember: true, membershipExpiresAt: future, stripeSubscriptionId: 'sub_1' })).toBe(false);
  });
});
