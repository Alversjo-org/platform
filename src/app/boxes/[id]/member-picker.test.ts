import { describe, expect, it } from 'vitest';
import { matchesQuery } from './member-picker';

const christian = { id: 'u1', email: 'christiandietrichsen@gmail.com', name: 'Christian Dietrichwen', nickname: 'Chris' };

describe('matchesQuery', () => {
  it('matches on name, nickname or email, case-insensitively', () => {
    expect(matchesQuery(christian, 'chri')).toBe(true);
    expect(matchesQuery(christian, 'DIETRICH')).toBe(true);
    expect(matchesQuery(christian, 'chris')).toBe(true);
    expect(matchesQuery(christian, 'gmail')).toBe(true);
  });

  it('rejects a query that matches nothing', () => {
    expect(matchesQuery(christian, 'anna')).toBe(false);
  });

  it('matches everyone on an empty or blank query', () => {
    expect(matchesQuery(christian, '')).toBe(true);
    expect(matchesQuery(christian, '  ')).toBe(true);
  });
});
