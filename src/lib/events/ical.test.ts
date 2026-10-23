import { describe, expect, it } from 'vitest';
import { buildEventIcs, buildFeedIcs } from './ical';

describe('ical', () => {
  const event = { uid: 'e1', title: 'Work day', startsAt: new Date('2027-06-20T08:00:00Z'), endsAt: new Date('2027-06-20T16:00:00Z'), description: 'Bring gloves' };

  it('buildEventIcs produces a single VEVENT with UTC timestamps', () => {
    const ics = buildEventIcs(event);
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('UID:e1');
    expect(ics).toContain('SUMMARY:Work day');
    expect(ics).toContain('DTSTART:20270620T080000Z');
    expect(ics).toContain('DTEND:20270620T160000Z');
    expect(ics).toContain('END:VEVENT');
  });

  it('buildFeedIcs wraps multiple events in one VCALENDAR', () => {
    const ics = buildFeedIcs([event, { ...event, uid: 'e2', title: 'Second' }]);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
  });

  it('includes the RFC 5545-required PRODID and a DTSTAMP on every event', () => {
    const ics = buildEventIcs(event);
    expect(ics).toContain('PRODID:');
    expect(ics).toMatch(/DTSTAMP:\d{8}T\d{6}Z/);
  });

  it('escapes commas, semicolons, backslashes and newlines in SUMMARY and DESCRIPTION, as single content lines', () => {
    const ics = buildEventIcs({ ...event, title: 'Work, day; really', description: 'Line one\nLine two\\end' });
    expect(ics).toContain('SUMMARY:Work\\, day\\; really');
    expect(ics).toContain('DESCRIPTION:Line one\\nLine two\\\\end');
    // a real (unescaped) newline would add an extra content line to the VEVENT block
    expect(ics.split('\r\n')).toEqual([
      'BEGIN:VCALENDAR', 'VERSION:2.0', expect.stringMatching(/^PRODID:/), 'BEGIN:VEVENT', 'UID:e1',
      'SUMMARY:Work\\, day\\; really', 'DESCRIPTION:Line one\\nLine two\\\\end', expect.stringMatching(/^DTSTAMP:/),
      'DTSTART:20270620T080000Z', 'DTEND:20270620T160000Z', 'END:VEVENT', 'END:VCALENDAR',
    ]);
  });
});
