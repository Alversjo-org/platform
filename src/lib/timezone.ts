const TIME_ZONE = 'Europe/Stockholm';

function stockholmPartsAt(instant: Date): Record<string, string> {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant).reduce<Record<string, string>>((acc, p) => { acc[p.type] = p.value; return acc; }, {});
}

function stockholmOffsetMinutesAt(instant: Date): number {
  const p = stockholmPartsAt(instant);
  const asIfUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return (asIfUtc - instant.getTime()) / 60_000;
}

/** Converts a "YYYY-MM-DDTHH:mm" wall-clock value (as produced by a `datetime-local` input) meant as Europe/Stockholm time into the UTC instant it refers to. */
export function stockholmWallClockToUtc(wallClock: string): Date {
  const naiveUtcGuess = new Date(`${wallClock}:00.000Z`);
  const offsetMinutes = stockholmOffsetMinutesAt(naiveUtcGuess);
  return new Date(naiveUtcGuess.getTime() - offsetMinutes * 60_000);
}

/** Formats a UTC instant as its Europe/Stockholm wall clock, as "YYYY-MM-DDTHH:mm" (for a `datetime-local` input value). */
export function utcToStockholmWallClock(date: Date): string {
  const p = stockholmPartsAt(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
