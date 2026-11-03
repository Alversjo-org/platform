import { cn } from 'cn';

/** Small status and fact pills. */
export function Pill({ tone = 'plain', className, children }: { tone?: 'plain' | 'good' | 'sun' | 'muted'; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
      tone === 'plain' && 'bg-forest/8 text-ink',
      tone === 'good' && 'bg-good/16 text-good-ink',
      tone === 'sun' && 'bg-sun/55 text-ink',
      tone === 'muted' && 'bg-ink/8 text-ink-soft',
      className,
    )}>
      {children}
    </span>
  );
}

/** Avatar fill colours, picked by position so a list doesn't repeat neighbours. */
export const AVATAR_TINTS = ['bg-[#f2a37a]', 'bg-[#9ed8b4]', 'bg-[#b9a6f2]', 'bg-sun', 'bg-[#8fb3ee]', 'bg-[#eac39a]'];
