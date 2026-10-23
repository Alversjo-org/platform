import { describe, expect, it } from 'vitest';
import { stockholmWallClockToUtc, utcToStockholmWallClock } from './timezone';

describe('timezone', () => {
  it('converts a summer (CEST, UTC+2) Stockholm wall clock to UTC', () => {
    expect(stockholmWallClockToUtc('2027-06-20T18:00').toISOString()).toBe('2027-06-20T16:00:00.000Z');
  });

  it('converts a winter (CET, UTC+1) Stockholm wall clock to UTC', () => {
    expect(stockholmWallClockToUtc('2027-01-15T18:00').toISOString()).toBe('2027-01-15T17:00:00.000Z');
  });

  it('formats a UTC instant back as its Stockholm wall clock (summer)', () => {
    expect(utcToStockholmWallClock(new Date('2027-06-20T16:00:00.000Z'))).toBe('2027-06-20T18:00');
  });

  it('formats a UTC instant back as its Stockholm wall clock (winter)', () => {
    expect(utcToStockholmWallClock(new Date('2027-01-15T17:00:00.000Z'))).toBe('2027-01-15T18:00');
  });

  it('round-trips a wall clock through UTC and back, across the DST boundary', () => {
    for (const wallClock of ['2027-06-20T18:00', '2027-01-15T18:00', '2027-03-28T03:30', '2027-10-31T03:30']) {
      expect(utcToStockholmWallClock(stockholmWallClockToUtc(wallClock))).toBe(wallClock);
    }
  });
});
