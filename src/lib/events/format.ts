import { splitStockholmDateAndTime } from '@/lib/timezone';

const TIME_ZONE = 'Europe/Stockholm';
const dayMonth = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short' }).format(d).replace(',', '');

/** "Fri 20 Nov, 19:00–23:00", or "Fri 30 Oct 18:00 – Sun 1 Nov 15:00" across days. All-day events drop the times. */
export function formatEventSpan(startsAt: Date, endsAt: Date): string {
  const s = splitStockholmDateAndTime(startsAt);
  const e = splitStockholmDateAndTime(endsAt);
  if (s.date === e.date || (e.time === null && s.time !== null && e.date > s.date && sameAsDayAfter(s.date, e.date))) {
    return s.time ? `${dayMonth(startsAt)}, ${s.time}–${e.time ?? '24:00'}` : dayMonth(startsAt);
  }
  if (!s.time && !e.time) return `${dayMonth(startsAt)} – ${dayMonth(endsAt)}`;
  return `${dayMonth(startsAt)} ${s.time ?? ''} – ${dayMonth(endsAt)} ${e.time ?? ''}`.replace(/\s+/g, ' ').trim();
}

function sameAsDayAfter(a: string, b: string): boolean {
  const d = new Date(`${a}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10) === b;
}
