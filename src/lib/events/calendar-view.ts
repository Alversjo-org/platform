import type { EventDetails, Project } from '@/db/schema';
import { splitStockholmDateAndTime } from '@/lib/timezone';

export type CalendarEvent = { id: string; title: string; start: string; end: string; allDay: boolean; url: string };

function addDaysToDateString(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Maps event rows to FullCalendar event objects. All-day events get their end date shifted one day later, since FullCalendar treats `end` as exclusive. */
export function toCalendarEvents(rows: { project: Pick<Project, 'slug' | 'title'>; details: EventDetails }[]): CalendarEvent[] {
  return rows.map(({ project, details }) => {
    const starts = splitStockholmDateAndTime(details.startsAt);
    const ends = splitStockholmDateAndTime(details.endsAt);
    const allDay = starts.time === null && ends.time === null;
    return {
      id: `${project.slug}`,
      title: project.title,
      start: allDay ? starts.date : `${starts.date}T${starts.time}`,
      end: allDay ? addDaysToDateString(ends.date, 1) : `${ends.date}T${ends.time}`,
      allDay,
      url: `/events/${project.slug}`,
    };
  });
}
