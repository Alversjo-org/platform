import { describe, expect, it } from 'vitest';
import { formatEventSpan } from './format';

describe('formatEventSpan', () => {
  it('shows one day with a time range', () => {
    expect(formatEventSpan(new Date('2026-11-20T18:00:00Z'), new Date('2026-11-20T22:00:00Z'))).toBe('Fri 20 Nov, 19:00–23:00');
  });
  it('treats an evening ending at midnight as one day', () => {
    expect(formatEventSpan(new Date('2026-11-20T18:00:00Z'), new Date('2026-11-20T23:00:00Z'))).toBe('Fri 20 Nov, 19:00–24:00');
  });
  it('spells out both ends across days', () => {
    expect(formatEventSpan(new Date('2026-10-30T17:00:00Z'), new Date('2026-11-01T14:00:00Z'))).toBe('Fri 30 Oct 18:00 – Sun 1 Nov 15:00');
  });
});
