export type IcsEvent = { uid: string; title: string; startsAt: Date; endsAt: Date; description: string };

function formatIcsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escapeIcsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => `\\${m}`);
}

function veventBlock(event: IcsEvent): string {
  return [
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `DESCRIPTION:${escapeIcsText(event.description)}`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
    `DTSTART:${formatIcsDate(event.startsAt)}`,
    `DTEND:${formatIcsDate(event.endsAt)}`,
    'END:VEVENT',
  ].join('\r\n');
}

const PRODID = 'PRODID:-//Alversjö//platform//EN';

export function buildEventIcs(event: IcsEvent): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', PRODID, veventBlock(event), 'END:VCALENDAR'].join('\r\n');
}

export function buildFeedIcs(events: IcsEvent[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', PRODID, ...events.map(veventBlock), 'END:VCALENDAR'].join('\r\n');
}
