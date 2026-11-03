'use client';

import type { Map as LeafletMap } from 'leaflet';
import { cn } from 'cn';

/** A 44 px round button floating over the map (night glass). */
export function RoundButton({ label, onClick, children, className }: { label: string; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button type="button" aria-label={label} onClick={onClick}
      className={cn('flex size-11 items-center justify-center rounded-full border border-white/20 bg-night/55 text-lg text-white shadow-[0_4px_16px_rgb(0_0_0/0.18)] backdrop-blur-md', className)}>
      {children}
    </button>
  );
}

/** Zoom in, zoom out and back-to-start, stacked. */
export function ZoomButtons({ map, home, className }: { map: LeafletMap | null; home: () => void; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <RoundButton label="Zoom in" onClick={() => map?.zoomIn()}>+</RoundButton>
      <RoundButton label="Zoom out" onClick={() => map?.zoomOut()}>−</RoundButton>
      <RoundButton label="Back to the start" onClick={home}>◎</RoundButton>
    </div>
  );
}
