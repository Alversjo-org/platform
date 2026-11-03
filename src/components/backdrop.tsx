import Image from 'next/image';
import { cn } from 'cn';

/** The photos pages sit on (public/photos), each with its caption. */
export const PHOTOS = {
  winterSun: { src: '/photos/Bath-alNoor_winter-sun.jpg', caption: 'Bath al-Noor, winter sun' },
  gateKeepers: { src: '/photos/Gate-Keepers-in-the-Sun.jpg', caption: 'Gate Keepers in the sun' },
  night: { src: '/photos/Bayt_al_Noor_by_night.jpg', caption: 'Bayt al-Noor by night' },
  square: { src: '/photos/The-Square.jpg', caption: 'The Square' },
  bonfire: { src: '/photos/287062.jpg', caption: 'Bonfire' },
} as const;

export type Photo = keyof typeof PHOTOS;

/**
 * A fixed, full-viewport photo with a wash over it for readability. `wash` is any CSS
 * background (usually a gradient); `blur` blurs the photo itself, not the glass on top.
 */
export function Backdrop({ photo, wash, blur = 0, caption = false, className }: {
  photo: Photo; wash: string; blur?: number; caption?: boolean; className?: string;
}) {
  const p = PHOTOS[photo];
  return (
    <div aria-hidden={!caption} className={cn('pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-snow', className)}>
      <Image
        src={p.src}
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover"
        // Blur bleeds transparent edges in; scaling up a little hides them.
        style={blur ? { filter: `blur(${blur}px)`, transform: 'scale(1.06)' } : undefined}
      />
      <div className="absolute inset-0" style={{ background: wash }} />
      {caption && (
        <p className="absolute top-10 right-20 hidden text-xs font-medium text-white/90 md:block">{p.caption}</p>
      )}
    </div>
  );
}
