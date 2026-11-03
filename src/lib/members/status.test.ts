import { describe, expect, it } from 'vitest';
import { isActiveNow } from './status';

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
