import { describe, expect, it } from 'vitest';
import { ROLE_LABELS } from './labels';

describe('ROLE_LABELS', () => {
  it('gives every role a distinct, human display label', () => {
    expect(ROLE_LABELS).toEqual({
      admin: 'Superadmin',
      'role-admin': 'Role-Manager',
      'member-admin': 'Member-Manager',
      mapper: 'Mapper',
      treasurer: 'Treasurer',
    });
    const labels = Object.values(ROLE_LABELS);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
