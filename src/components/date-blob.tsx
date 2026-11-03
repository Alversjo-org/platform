import { cn } from 'cn';

const TIME_ZONE = 'Europe/Stockholm';

/** "Sat 10:00" in Stockholm time. */
export function weekdayTime(date: Date): string {
  const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, weekday: 'short' }).format(date);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  return `${weekday} ${time}`;
}

/**
 * The month-and-day square in event rows. `lantern` is the purple gradient used on the
 * dark events pages; `muted` is for drafts there.
 */
export function DateBlob({ date, variant = 'plain', className }: { date: Date; variant?: 'plain' | 'lantern' | 'muted'; className?: string }) {
  const month = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, month: 'short' }).format(date).toUpperCase();
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, day: 'numeric' }).format(date);
  return (
    <div
      className={cn(
        'flex size-14 shrink-0 flex-col items-center justify-center rounded-2xl leading-none',
        variant === 'plain' && 'bg-forest/10 text-ink',
        variant === 'lantern' && 'bg-linear-to-b from-lantern to-[#6b5bd9] text-white',
        variant === 'muted' && 'bg-white/10 text-white',
        className,
      )}
    >
      <span className={cn('text-[10px] font-semibold tracking-[0.08em]', variant === 'plain' ? 'text-ink-soft' : 'text-white/85')}>{month}</span>
      <span className="mt-1 font-serif text-[22px] font-bold">{day}</span>
    </div>
  );
}
