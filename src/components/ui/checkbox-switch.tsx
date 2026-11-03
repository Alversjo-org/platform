import { cn } from 'cn';

/**
 * A native checkbox drawn as an on/off switch, so it posts with its form like any checkbox
 * (Switch is the button version, for client state).
 */
function CheckboxSwitch({ className, ...props }: Omit<React.ComponentProps<'input'>, 'type'>) {
  return (
    <input
      type="checkbox"
      role="switch"
      data-slot="checkbox-switch"
      className={cn(
        'relative h-7 w-11 shrink-0 cursor-pointer appearance-none rounded-full border border-ink/10 bg-ink/12 transition-colors checked:bg-forest',
        "before:absolute before:top-[1px] before:left-px before:size-6 before:rounded-full before:bg-white before:shadow before:transition-transform before:content-[''] checked:before:translate-x-4",
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { CheckboxSwitch };
