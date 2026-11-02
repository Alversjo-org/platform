import { describe, expect, it } from 'vitest';
import { GRANTABLE_ROLES, ROLE_LABELS, SELF_REQUESTABLE_ROLES } from './labels';

describe('ROLE_LABELS', () => {
  it('gives every role a distinct, human display label', () => {
    expect(ROLE_LABELS).toEqual({
      admin: 'Superadmin',
      'role-admin': 'Role-Manager',
      'member-admin': 'Member-Manager',
      mapper: 'Mapper',
      treasurer: 'Treasurer',
      'wiki-editor': 'Wiki editor',
    });
    const labels = Object.values(ROLE_LABELS);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('wiki-editor is grantable, labeled, and self-requestable', () => {
    expect(GRANTABLE_ROLES).toContain('wiki-editor');
    expect(ROLE_LABELS['wiki-editor']).toBe('Wiki editor');
    expect(SELF_REQUESTABLE_ROLES).toEqual(['wiki-editor']);
  });
});
