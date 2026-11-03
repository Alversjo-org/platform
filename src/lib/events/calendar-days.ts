import { splitStockholmDateAndTime } from '@/lib/timezone';

export type CalendarDay = { date: string; slug: string; title: string };

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * One entry per Stockholm calendar day each event covers. A timed event that ends at
 * midnight doesn't take up the day it ends on; an all-day event (no times) includes its
 * end date, as in toCalendarEvents.
 */
export function toCalendarDays(events: { slug: string; title: string; startsAt: Date; endsAt: Date }[]): CalendarDay[] {
  const days: CalendarDay[] = [];
  for (const e of events) {
    const start = splitStockholmDateAndTime(e.startsAt);
    const end = splitStockholmDateAndTime(e.endsAt);
    // splitStockholmDateAndTime reports midnight as no time.
    const endsAtMidnight = end.time === null && start.time !== null && end.date > start.date;
    const last = endsAtMidnight ? addDays(end.date, -1) : end.date;
    for (let d = start.date; d <= last; d = addDays(d, 1)) days.push({ date: d, slug: e.slug, title: e.title });
  }
  return days;
}
