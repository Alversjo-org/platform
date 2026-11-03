import { describe, expect, it } from 'vitest';
import { toCalendarDays } from './calendar-days';

describe('toCalendarDays', () => {
  it('marks every Stockholm day an event covers', () => {
    const days = toCalendarDays([{ slug: 'w', title: 'Work weekend', startsAt: new Date('2026-10-30T16:00:00Z'), endsAt: new Date('2026-11-01T15:00:00Z') }]);
    expect(days.map((d) => d.date)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
  });
  it('leaves out the day an event ends on at midnight', () => {
    // 2026-11-14 18:00 to 2026-11-15 00:00, Stockholm time (UTC+1).
    const days = toCalendarDays([{ slug: 'p', title: 'Party', startsAt: new Date('2026-11-14T17:00:00Z'), endsAt: new Date('2026-11-14T23:00:00Z') }]);
    expect(days.map((d) => d.date)).toEqual(['2026-11-14']);
  });
});
