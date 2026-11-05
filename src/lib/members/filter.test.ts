import { describe, expect, it } from 'vitest';
import { filterMembers, matchesQuery, membersSearchHref, rolesReturnTo } from './filter';

const anna = { id: 'u1', email: 'anna@example.com', name: 'Anna Lindqvist', nickname: null };
const joanna = { id: 'u2', email: 'joanna@example.com', name: 'Joanna Berg', nickname: 'Jo' };
const per = { id: 'u3', email: 'per@example.com', name: 'Per Ek', nickname: null };

describe('matchesQuery', () => {
  it('matches on name, nickname or email, case-insensitively', () => {
    expect(matchesQuery(joanna, 'BERG')).toBe(true);
    expect(matchesQuery(joanna, 'jo')).toBe(true);
    expect(matchesQuery(joanna, 'example.com')).toBe(true);
  });

  it('rejects a query that matches nothing', () => {
    expect(matchesQuery(per, 'ann')).toBe(false);
  });

  it('matches everyone on an empty or blank query', () => {
    expect(matchesQuery(per, '')).toBe(true);
    expect(matchesQuery(per, '   ')).toBe(true);
  });

  it('ignores whitespace around the query', () => {
    expect(matchesQuery(anna, '  anna ')).toBe(true);
  });
});

describe('filterMembers', () => {
  it('keeps only matching members, in their original order', () => {
    expect(filterMembers([anna, per, joanna], 'ann').map((m) => m.id)).toEqual(['u1', 'u2']);
  });

  it('returns everyone for a blank query', () => {
    expect(filterMembers([anna, per], '')).toHaveLength(2);
  });
});

describe('membersSearchHref', () => {
  it('keeps the status tab and encodes the search text', () => {
    expect(membersSearchHref('active', 'anna lind')).toBe('/members?status=active&q=anna%20lind');
  });

  it('leaves q out when the search is blank', () => {
    expect(membersSearchHref('inactive', '  ')).toBe('/members?status=inactive');
  });
});

describe('rolesReturnTo', () => {
  it('returns to /roles with the search text so a grant keeps the list filtered', () => {
    expect(rolesReturnTo('anna')).toBe('/roles?q=anna');
  });

  it('is plain /roles when there is no search', () => {
    expect(rolesReturnTo('  ')).toBe('/roles');
  });
});
