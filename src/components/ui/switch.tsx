'use client';

import { cn } from 'cn';

/** An on/off toggle (role="switch"). */
function Switch({ checked, onCheckedChange, className, ...props }: Omit<React.ComponentProps<'button'>, 'onChange'> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-slot="switch"
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-7 w-11 shrink-0 items-center rounded-full border border-white/25 transition-colors',
        checked ? 'bg-forest' : 'bg-white/15',
        className,
      )}
      {...props}
    >
      <span className={cn('size-6 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-px')} />
    </button>
  );
}

export { Switch };
