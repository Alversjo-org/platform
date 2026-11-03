'use client';

import Link from 'next/link';
import { useState } from 'react';
import { cn } from 'cn';
import type { CalendarDay } from '@/lib/events/calendar-days';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

/** Monday-first weeks covering the month, each a list of YYYY-MM-DD dates. */
function weeksOf(year: number, month: number): string[][] {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const count = Math.ceil((offset + daysInMonth) / 7) * 7;
  const dates = Array.from({ length: count }, (_, i) => iso(year, month, 1 - offset + i));
  return Array.from({ length: count / 7 }, (_, w) => dates.slice(w * 7, w * 7 + 7));
}

/**
 * The events month as a glass card: event days are lantern circles that open the event,
 * today has a sun ring. On phones it folds to the current week until "Month" is tapped.
 */
export function MonthCalendar({ days, today }: { days: CalendarDay[]; today: string }) {
  const [y, m] = today.split('-').map(Number);
  const [shown, setShown] = useState({ year: y, month: m - 1 });
  const [expanded, setExpanded] = useState(false);
  const byDate = new Map<string, CalendarDay[]>();
  for (const d of days) byDate.set(d.date, [...(byDate.get(d.date) ?? []), d]);

  const weeks = weeksOf(shown.year, shown.month);
  const thisMonth = shown.year === y && shown.month === m - 1;
  const todayWeek = thisMonth ? weeks.findIndex((w) => w.includes(today)) : 0;
  const title = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(shown.year, shown.month, 1)));
  const step = (delta: number) => setShown(({ year, month }) => {
    const d = new Date(Date.UTC(year, month + delta, 1));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
  });

  return (
    <section className="glass rounded-[30px] p-5 md:rounded-[28px] md:p-7" aria-label="Calendar">
      <div className="flex items-center gap-2">
        <h2 className="font-serif text-[22px] font-bold md:text-[26px]">{title}</h2>
        <div className="flex-1" />
        <div className={cn('gap-2', expanded ? 'flex' : 'hidden md:flex')}>
          <button type="button" onClick={() => step(-1)} aria-label="Previous month" className="flex size-11 items-center justify-center rounded-full border border-white/20 text-lg">‹</button>
          <button type="button" onClick={() => step(1)} aria-label="Next month" className="flex size-11 items-center justify-center rounded-full border border-white/20 text-lg">›</button>
        </div>
        <button type="button" onClick={() => setExpanded((e) => !e)} className="px-1 py-3 text-[15px] font-semibold text-white/80 md:hidden">
          {expanded ? 'Week' : 'Month'}
        </button>
      </div>
      <div role="grid" className="mt-4 grid grid-cols-7 gap-y-1 text-center md:mt-5">
        {WEEKDAYS.map((d) => <div key={d} role="columnheader" className="pb-1 text-xs font-medium text-white/70">{d}</div>)}
        {weeks.map((week, wi) => week.map((date) => {
          const events = byDate.get(date) ?? [];
          const inMonth = date.slice(5, 7) === String(shown.month + 1).padStart(2, '0');
          const isToday = date === today;
          const dayNumber = Number(date.slice(8));
          const circle = cn(
            'mx-auto flex size-11 items-center justify-center rounded-full text-[15px] tabular md:size-[52px] md:text-base',
            !inMonth && 'text-white/45',
            isToday && 'font-semibold text-sun ring-2 ring-sun',
            events.length > 0 && 'bg-linear-to-b from-lantern to-[#6b5bd9] font-semibold text-white',
          );
          return (
            <div key={date} role="gridcell" className={cn(!expanded && wi !== Math.max(todayWeek, 0) && 'hidden md:block')}>
              {events.length > 0 ? (
                <Link href={`/events/${events[0].slug}`} title={events.map((e) => e.title).join(', ')} className={circle}>
                  {dayNumber}
                </Link>
              ) : (
                <span className={circle}>{dayNumber}</span>
              )}
            </div>
          );
        }))}
      </div>
      <p className="mt-5 hidden text-sm text-white/80 md:block">
        Add to my calendar keeps every published event in your own calendar app.
      </p>
    </section>
  );
}
