import { describe, expect, it } from 'vitest';
import { resolveDialogTarget } from './dialog-target';

describe('resolveDialogTarget', () => {
  const members = [
    { id: 'a', isActiveMember: true },
    { id: 'b', isActiveMember: false },
  ];

  it('finds a member by edit id regardless of any status filtering already applied to a separate displayed list', () => {
    expect(resolveDialogTarget(members, { edit: 'b' })).toEqual({ id: 'b', isActiveMember: false });
  });

  it('finds a member by roles id', () => {
    expect(resolveDialogTarget(members, { roles: 'a' })).toEqual({ id: 'a', isActiveMember: true });
  });

  it('returns undefined when neither param is present, or points at an unknown id', () => {
    expect(resolveDialogTarget(members, {})).toBeUndefined();
    expect(resolveDialogTarget(members, { edit: 'nonexistent' })).toBeUndefined();
  });
});
