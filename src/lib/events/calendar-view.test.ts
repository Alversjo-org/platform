import { describe, expect, it } from 'vitest';
import type { EventDetails, Project } from '@/db/schema';
import { toCalendarEvents } from './calendar-view';

function row(overrides: Partial<EventDetails> & { slug?: string; title?: string }): { project: Project; details: EventDetails } {
  const { slug = 'test-event', title = 'Test event', ...detailOverrides } = overrides;
  return {
    project: { slug, title } as Project,
    details: {
      startsAt: new Date('2027-06-19T22:00:00Z'), // 2027-06-20 00:00 CEST (all day)
      endsAt: new Date('2027-06-19T22:00:00Z'),
      ...detailOverrides,
    } as EventDetails,
  };
}

describe('toCalendarEvents', () => {
  it('shifts the end date one day later for a single all-day event, since FullCalendar end dates are exclusive', () => {
    const [event] = toCalendarEvents([row({})]);
    expect(event.allDay).toBe(true);
    expect(event.start).toBe('2027-06-20');
    expect(event.end).toBe('2027-06-21');
  });

  it('shifts the end date one day past the last day of a multi-day all-day event', () => {
    const [event] = toCalendarEvents([row({ endsAt: new Date('2027-06-21T22:00:00Z') })]); // 2027-06-22 00:00 CEST
    expect(event.start).toBe('2027-06-20');
    expect(event.end).toBe('2027-06-23');
  });

  it('keeps exact start/end instants for a timed event, without the all-day date shift', () => {
    const [event] = toCalendarEvents([row({ startsAt: new Date('2027-06-20T07:00:00Z'), endsAt: new Date('2027-06-20T15:00:00Z') })]);
    expect(event.allDay).toBe(false);
    expect(event.start).toBe('2027-06-20T09:00');
    expect(event.end).toBe('2027-06-20T17:00');
  });

  it('builds the event URL from the project slug and uses the title', () => {
    const [event] = toCalendarEvents([row({ slug: 'midsummer', title: 'Midsummer party' })]);
    expect(event.url).toBe('/events/midsummer');
    expect(event.title).toBe('Midsummer party');
  });
});
