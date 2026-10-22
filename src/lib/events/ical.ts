export type IcsEvent = { uid: string; title: string; startsAt: Date; endsAt: Date; description: string };

function formatIcsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function veventBlock(event: IcsEvent): string {
  return [
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `SUMMARY:${event.title}`,
    `DESCRIPTION:${event.description}`,
    `DTSTART:${formatIcsDate(event.startsAt)}`,
    `DTEND:${formatIcsDate(event.endsAt)}`,
    'END:VEVENT',
  ].join('\r\n');
}

export function buildEventIcs(event: IcsEvent): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', veventBlock(event), 'END:VCALENDAR'].join('\r\n');
}

export function buildFeedIcs(events: IcsEvent[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.map(veventBlock), 'END:VCALENDAR'].join('\r\n');
}
