'use client';

import type { Map as LeafletMap } from 'leaflet';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { DateBlob, weekdayTime } from '@/components/date-blob';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from 'cn';
import { DRONE_2026, SITE_ZOOM } from '@/lib/map/constants';
import { FEATURE_KINDS, MAP_LAYERS, type MapLayerId } from '@/lib/map/feature-kinds';
import type { MapFeatureData } from '@/lib/map/features';
import type { MapAreaData } from '@/lib/map/view-model';
import type { MapLayersState } from './base-map';

// Leaflet needs `window`, and keeping it out of the server bundle means only map pages download it.
const MapViewLeaflet = dynamic(() => import('./map-view-leaflet'), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-night/40" />,
});

/** Swatch per layer: the colour of its first kind. */
const LAYER_COLOR = Object.fromEntries(MAP_LAYERS.map((l) => [l.id, Object.values(FEATURE_KINDS).find((k) => k.layer === l.id)?.color ?? '#999'])) as Record<MapLayerId, string>;
const LAYER_LABEL: Partial<Record<MapLayerId, string>> = { places: 'Places', water: 'Lakes & water protection' };
const ha = (n: number) => `${n.toLocaleString('sv-SE')} ha`;

function LayersIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
      <path d="M12 3 2.5 8 12 13l9.5-5L12 3Z" />
      <path d="m2.5 12.5 9.5 5 9.5-5" />
      <path d="m2.5 16.5 9.5 5 9.5-5" opacity=".6" />
    </svg>
  );
}

function RoundButton({ label, onClick, children, className }: { label: string; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button type="button" aria-label={label} onClick={onClick}
      className={cn('flex size-11 items-center justify-center rounded-full border border-white/20 bg-night/55 text-lg text-white shadow-[0_4px_16px_rgb(0_0_0/0.18)] backdrop-blur-md', className)}>
      {children}
    </button>
  );
}

export function MapView({ areas, features, canEditFeatures, canEditOutlines }: {
  areas: MapAreaData[];
  features: MapFeatureData[];
  canEditFeatures: boolean;
  canEditOutlines: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<'none' | 'layers'>('none');
  const [tab, setTab] = useState<'layers' | 'areas'>('layers');
  const [background, setBackground] = useState<'drone' | 'street'>('drone');
  const [oldMap, setOldMap] = useState(false);
  const [areasOn, setAreasOn] = useState(true);
  const [on, setOn] = useState<MapLayerId[]>(MAP_LAYERS.filter((l) => l.defaultOn).map((l) => l.id));
  const [zoom, setZoom] = useState(SITE_ZOOM);
  const [map, setMap] = useState<LeafletMap | null>(null);

  const selected = areas.find((a) => a.id === selectedId) ?? null;

  // Open on the land (the drone photo's extent); the recentre button comes back here.
  const home = useCallback(() => {
    if (!map) return;
    const wide = window.matchMedia('(min-width: 48rem)').matches;
    map.fitBounds(DRONE_2026.bounds, {
      paddingTopLeft: wide ? [80, 110] : [0, 110],
      paddingBottomRight: wide ? [80, 90] : [0, 100],
    });
  }, [map]);
  useEffect(() => { home(); }, [home]);
  const layersOnCount = on.length + (oldMap ? 1 : 0);
  const counts = Object.fromEntries(MAP_LAYERS.map((l) => [l.id, features.filter((f) => FEATURE_KINDS[f.kind].layer === l.id).length])) as Record<MapLayerId, number>;
  const layers: MapLayersState = { background, oldMap, layers: on, iconSize: zoom >= 18 ? 28 : 22 };
  const toggle = (id: MapLayerId, value: boolean) => setOn((cur) => (value ? [...cur, id] : cur.filter((x) => x !== id)));
  const select = (id: string) => {
    setSelectedId(id);
    setPanel('none');
    // On phones the area's sheet covers the lower half: bring the area into the top half.
    const area = areas.find((a) => a.id === id);
    if (map && area && !window.matchMedia('(min-width: 48rem)').matches) {
      const point = map.latLngToContainerPoint(area.label);
      map.panBy([point.x - map.getSize().x / 2, point.y - map.getSize().y * 0.25]);
    }
  };
  const toggleLayersPanel = () => { setPanel((p) => (p === 'layers' ? 'none' : 'layers')); setSelectedId(null); };

  return (
    <>
      <div className="fixed inset-0 z-0">
        <MapViewLeaflet
          areas={areas} features={features} canEditFeatures={canEditFeatures}
          selectedId={selectedId} onSelect={select} layers={layers} areasOn={areasOn} quietAreas={on.includes('sound')}
          mapRef={setMap} onZoom={setZoom}
        />
        {/* Readability wash over the tiles, and the gradient behind the nav. */}
        <div className="pointer-events-none absolute inset-0 z-[401] bg-[#0b1a33]/18" />
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[401] h-40 bg-linear-to-b from-[#0b1a33]/60 to-transparent" />
      </div>

      {areas.length === 0 && (
        <p className="glass fixed top-32 left-1/2 z-30 -translate-x-1/2 rounded-full px-5 py-3 text-sm">
          No areas have been mapped yet. Ask a mapper to draw one under Areas.
        </p>
      )}

      {/* Zoom and recentre, bottom left (desktop); recentre top right on phones. */}
      <div className="fixed bottom-28 left-10 z-30 hidden flex-col gap-2 md:flex">
        <RoundButton label="Zoom in" onClick={() => map?.zoomIn()}>+</RoundButton>
        <RoundButton label="Zoom out" onClick={() => map?.zoomOut()}>−</RoundButton>
        <RoundButton label="Back to the land" onClick={home}>◎</RoundButton>
      </div>
      <RoundButton label="Back to the land" onClick={home} className="fixed top-[52px] right-4 z-30 md:hidden">◎</RoundButton>

      {/* "The land" toolbar: the Layers button is the only way to switch layers. */}
      <div className="glass fixed top-[52px] left-4 z-30 flex items-center gap-3 rounded-full p-1 md:top-auto md:bottom-8 md:left-1/2 md:-translate-x-1/2 md:p-1.5 md:pl-5">
        <span className="hidden font-serif text-[22px] font-bold md:inline">The land</span>
        <button
          type="button" onClick={toggleLayersPanel} aria-expanded={panel === 'layers'}
          className={cn('flex h-11 items-center gap-2 rounded-full border px-4 text-[15px] font-semibold transition-colors',
            panel === 'layers' ? 'border-white bg-white text-ink' : 'border-white/25 bg-white/10 text-white')}
        >
          <LayersIcon /> Layers
          {layersOnCount > 0 && <span className={cn('rounded-full px-2 text-xs leading-5', panel === 'layers' ? 'bg-ink/10' : 'bg-white/20')}>{layersOnCount}</span>}
        </button>
      </div>

      {selected && (
        <aside className="glass fixed inset-x-2 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 flex max-h-[55svh] flex-col gap-3 overflow-y-auto rounded-[34px] p-6 md:inset-x-auto md:top-auto md:right-10 md:bottom-28 md:max-h-[calc(100svh-15rem)] md:w-[400px] md:rounded-[32px] md:p-7">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: selected.color, boxShadow: `0 0 8px ${selected.color}` }} />
            <span className="text-xs font-semibold tracking-[0.08em] text-white/75 uppercase">Area</span>
            <div className="flex-1" />
            <RoundButton label="Close" onClick={() => setSelectedId(null)}>×</RoundButton>
          </div>
          <h2 className="font-serif text-[32px] leading-tight font-bold md:text-[40px]">{selected.name}</h2>
          {selected.description && <p className="text-[15px] leading-relaxed text-white/85">{selected.description}</p>}
          <div className="flex flex-wrap gap-1.5">
            {[ha(selected.hectares), selected.capacity != null ? `Capacity: ${selected.capacity}` : 'Capacity: not set', selected.bookable ? 'Bookable' : 'Not bookable'].map((t) => (
              <span key={t} className="rounded-full bg-white/14 px-2.5 py-1 text-xs font-semibold">{t}</span>
            ))}
          </div>
          {selected.bookings.length > 0 && (
            <>
              <h3 className="pt-1 text-xs font-semibold tracking-[0.08em] text-white/70 uppercase">Booked</h3>
              {selected.bookings.map((b) => (
                <Link key={`${b.eventSlug}-${b.from}`} href={`/events/${b.eventSlug}`} className="flex items-center gap-3 rounded-[20px] bg-white/8 p-2 hover:bg-white/12">
                  <DateBlob date={new Date(b.startsAt)} variant="lantern" />
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold">{b.eventTitle}</p>
                    <p className="truncate text-sm text-white/70">{weekdayTime(new Date(b.startsAt))}–{b.to.slice(11)}</p>
                  </div>
                </Link>
              ))}
            </>
          )}
          {selected.bookable && (
            <Button size="lg" className="mt-1 w-full" nativeButton={false} render={<Link href={`/events/new?area=${encodeURIComponent(selected.id)}`} />}>Plan an event here</Button>
          )}
          {canEditOutlines && (
            <div className="flex items-center pt-1">
              <Link href={`/areas/${selected.id}/shape`} className="text-[15px] font-semibold underline underline-offset-4">Edit outline</Link>
              <div className="flex-1" />
              <span className="text-xs text-white/60">Mappers</span>
            </div>
          )}
        </aside>
      )}

      {panel === 'layers' && (
        <>
          {/* On phones the sheet is modal and covers the tab bar. */}
          <button type="button" aria-label="Close layers" onClick={() => setPanel('none')} className="fixed inset-0 z-40 bg-night/30 md:hidden" />
          <aside className="glass fixed inset-x-2 top-[30svh] bottom-2 z-50 flex flex-col gap-4 overflow-hidden rounded-[34px] p-5 md:inset-x-auto md:top-[122px] md:right-10 md:bottom-10 md:w-[386px] md:rounded-[32px] md:p-6">
            <div className="flex items-center">
              <h2 className="font-serif text-[28px] font-bold">On the map</h2>
              <div className="flex-1" />
              <RoundButton label="Close layers" onClick={() => setPanel('none')}>×</RoundButton>
            </div>
            <div role="tablist" className="flex rounded-full bg-white/10 p-1">
              {(['layers', 'areas'] as const).map((t) => (
                <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)}
                  className={cn('h-10 flex-1 rounded-full text-[15px] font-semibold', tab === t ? 'bg-white text-ink' : 'text-white')}>
                  {t === 'layers' ? 'Layers' : <>Areas <span className="font-normal opacity-70">{areas.length}</span></>}
                </button>
              ))}
            </div>
            <div className="-mr-2 flex-1 overflow-y-auto pr-2">
              {tab === 'layers' ? (
                <div className="flex flex-col gap-3">
                  <h3 className="text-xs font-semibold tracking-[0.08em] text-white/70 uppercase">Background</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {([['drone', 'Drone photo', 'July 2026'], ['street', 'Street map', 'OpenStreetMap']] as const).map(([id, label, sub]) => (
                      <button key={id} type="button" aria-pressed={background === id} onClick={() => setBackground(id)}
                        className={cn('flex flex-col items-start rounded-[18px] border px-4 py-2.5 text-left', background === id ? 'border-sun border-2 bg-white/12' : 'border-white/25')}>
                        <span className="text-[15px] font-semibold">{label}</span>
                        <span className="text-xs text-white/70">{sub}</span>
                      </button>
                    ))}
                  </div>
                  <ul className="mt-1 flex flex-col">
                    <LayerRow label="Old property map" color="#c9b48a" checked={oldMap} onChange={setOldMap} divider />
                    <LayerRow label="Areas" color="#f2a37a" count={areas.length} checked={areasOn} onChange={setAreasOn} />
                    {MAP_LAYERS.map((l) => (
                      <LayerRow key={l.id} label={LAYER_LABEL[l.id] ?? l.label} color={LAYER_COLOR[l.id]} count={counts[l.id]} dashed={l.id === 'borders'}
                        checked={on.includes(l.id)} onChange={(v) => toggle(l.id, v)} />
                    ))}
                  </ul>
                </div>
              ) : (
                <ul className="flex flex-col gap-1">
                  {areas.map((a) => (
                    <li key={a.id}>
                      <button type="button" onClick={() => select(a.id)} className="flex w-full items-center gap-3 rounded-[18px] px-3 py-3 text-left hover:bg-white/10">
                        <span className="size-2.5 rounded-full" style={{ background: a.color }} />
                        <span className="flex-1 text-[15px] font-semibold">{a.name}</span>
                        <span className="text-sm text-white/65">{ha(a.hectares)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex items-center gap-3 border-t border-white/15 pt-3 text-sm">
              <span className="text-white/75">GeoJSON: <a href="/map/areas.geojson" className="underline">areas</a> · <a href="/map/features.geojson" className="underline">features</a></span>
              <div className="flex-1" />
              {canEditFeatures && <Link href="/map/features" className="font-semibold text-sun">Edit map features →</Link>}
            </div>
          </aside>
        </>
      )}
    </>
  );
}

function LayerRow({ label, color, count, checked, onChange, dashed = false, divider = false }: {
  label: string; color: string; count?: number; checked: boolean; onChange: (v: boolean) => void; dashed?: boolean; divider?: boolean;
}) {
  return (
    <li className={cn('flex min-h-11 items-center gap-3', divider && 'mb-1 border-b border-white/15 pb-1')}>
      <span className={cn('size-3.5 rounded-[4px]', dashed && 'border-2 border-dashed bg-transparent')} style={dashed ? { borderColor: color } : { background: color }} />
      <span className="flex-1 text-[15px]">{label}{count !== undefined && <span className="ml-2 text-sm text-white/60">{count}</span>}</span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </li>
  );
}
