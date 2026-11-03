'use client';

import type { Map as LeafletMap } from 'leaflet';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useRef, useState } from 'react';
import { deleteMapFeatureAction, saveMapFeatureAction } from '@/app/map/features/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from 'cn';
import { DRONE_2026 } from '@/lib/map/constants';
import { FEATURE_KINDS, kindsForShape, MAP_LAYERS, type FeatureKind, type MapLayerId, type ShapeFamily } from '@/lib/map/feature-kinds';
import type { MapFeatureData } from '@/lib/map/features';
import { RoundButton, ZoomButtons } from './map-controls';
import type { GeometryReader, ShapeTool, ShapeToolsApi } from './shape-editor-tools';
import { ShapeToolRows } from './shape-tool-rows';

const FeatureEditorLeaflet = dynamic(() => import('./feature-editor-leaflet'), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-night/40" />,
});

const HELP: Record<ShapeFamily, string> = {
  point: 'Click the map to place the point, or drag it to move it.',
  line: 'Pick a tool below to draw the line, move its corners, drag it or remove parts.',
  polygon: 'Pick a tool below to draw the shape, move corners, drag it, cut holes or remove parts.',
};
const FAMILY_WORD: Record<ShapeFamily, string> = { point: 'Place', line: 'Line', polygon: 'Shape' };
const ICONS: Partial<Record<FeatureKind, string>> = {
  water: 'M6 0C6 0 .5 6.6.5 10c0 3 2.5 5 5.5 5s5.5-2 5.5-5C11.5 6.6 6 0 6 0Z',
  toilet: 'M0 0h4.5v6H0ZM0 7h12c0 3.2-2 5.2-4.4 5.7l.8 2.3H3l.6-2.5C1.5 11.7 0 9.7 0 7Z',
};
const LAYER_LABEL: Partial<Record<MapLayerId, string>> = { places: 'Places', water: 'Lakes & water protection' };

function KindMark({ kind }: { kind: FeatureKind }) {
  const color = FEATURE_KINDS[kind].color;
  const icon = ICONS[kind];
  if (icon) {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full" style={{ background: color }}>
        <svg viewBox="0 0 12 15" className="size-2.5" aria-hidden><path fill="#fff" d={icon} /></svg>
      </span>
    );
  }
  return <span className="mx-1 size-2 shrink-0 rounded-full" style={{ background: color }} />;
}

/**
 * Screen 17: every map feature, grouped by layer, beside the map. With `feature` (or `newShape`)
 * its edit card opens and the editor tools work on it.
 */
export function FeatureEditor({ feature, newShape, all }: {
  feature: MapFeatureData | null;
  /** Adding a new feature of this shape family. */
  newShape?: ShapeFamily;
  all: MapFeatureData[];
}) {
  const router = useRouter();
  const editing = feature !== null || newShape !== undefined;
  const shape: ShapeFamily = feature ? FEATURE_KINDS[feature.kind].shape : newShape ?? 'point';
  const kinds = kindsForShape(shape);
  const readGeometry = useRef<GeometryReader | null>(null);
  const tools = useRef<ShapeToolsApi | null>(null);
  const [map, setMap] = useState<LeafletMap | null>(null);
  const [active, setActive] = useState<ShapeTool | null>(null);
  const [kind, setKind] = useState<FeatureKind>(feature?.kind ?? kinds[0]);
  const [name, setName] = useState(feature?.name ?? '');
  const [description, setDescription] = useState(feature?.description ?? '');
  const [status, setStatus] = useState<'clean' | 'dirty' | 'saving' | 'saved' | 'confirm-delete'>('clean');
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<MapLayerId>>(() => new Set<MapLayerId>([feature ? FEATURE_KINDS[feature.kind].layer : 'places']));

  const others = useMemo(() => all.filter((f) => f.id !== feature?.id), [all, feature]);
  const onReady = useCallback((read: GeometryReader) => { readGeometry.current = read; }, []);
  const onChange = useCallback(() => { setStatus('dirty'); setError(null); }, []);
  const onTools = useCallback((api: ShapeToolsApi) => { tools.current = api; }, []);
  const onToolEnd = useCallback(() => setActive((t) => (t === 'draw' || t === 'rectangle' || t === 'cut' ? null : t)), []);
  const touch = <T,>(set: (v: T) => void) => (v: T) => { set(v); onChange(); };
  const choose = (tool: ShapeTool) => {
    const next = active === tool ? null : tool;
    tools.current?.use(next);
    setActive(next);
  };

  async function handleSave() {
    if (status === 'saving') return;
    tools.current?.use(null);
    setActive(null);
    setStatus('saving');
    setError(null);
    const result = await saveMapFeatureAction(feature?.id ?? null, {
      kind, name, description, geometry: readGeometry.current?.() ?? null,
    }).catch(() => ({ error: 'Could not save. Try again.' }));
    if ('error' in result) {
      setError(result.error);
      setStatus('dirty');
      return;
    }
    setStatus('saved');
    if (!feature) router.replace(`/map/features/${result.id}`);
    else router.refresh();
  }

  async function handleDelete() {
    if (!feature) return;
    if (status !== 'confirm-delete') { setStatus('confirm-delete'); return; }
    await deleteMapFeatureAction(feature.id);
    router.push('/map/features');
  }

  const q = query.trim().toLowerCase();
  const matches = (f: MapFeatureData) => !q || f.name.toLowerCase().includes(q) || FEATURE_KINDS[f.kind].label.toLowerCase().includes(q);

  return (
    <>
      <div className="fixed inset-0 z-0">
        <FeatureEditorLeaflet
          // A fresh map per feature, so editor state never carries over.
          key={feature?.id ?? newShape ?? 'browse'}
          editing={editing} layer={editing ? FEATURE_KINDS[kind].layer : null} shape={shape} initial={feature?.geometry ?? null} others={others}
          onReady={onReady} onChange={onChange} onTools={onTools} onToolEnd={onToolEnd} mapRef={setMap}
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[401] h-40 bg-linear-to-b from-[#0b1a33]/60 to-transparent" />
      </div>
      <ZoomButtons map={map} home={() => map?.fitBounds(DRONE_2026.bounds)} className="fixed right-10 bottom-28 z-30 hidden md:flex" />

      {/* The list (hidden on phones while a card is open). */}
      <aside className={cn('glass fixed inset-x-2 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 flex max-h-[50svh] flex-col gap-3 rounded-[32px] p-5 md:inset-x-auto md:top-[124px] md:bottom-10 md:left-10 md:max-h-none md:w-[380px] md:p-6', editing && 'hidden md:flex')}>
        <Link href="/map" className="self-start py-1 text-[15px] text-white/85">← Map</Link>
        <div>
          <h1 className="font-serif text-[30px] leading-tight font-bold">Map features</h1>
          <p className="text-sm text-white/75">{all.length} places, borders and zones besides the areas</p>
        </div>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a feature" aria-label="Find a feature"
          className="h-11 rounded-full border border-white/20 bg-white/10 px-4 text-base text-white outline-none placeholder:text-white/60" />
        <div className="grid grid-cols-3 gap-2">
          {(['point', 'line', 'polygon'] as const).map((s) => (
            <Button key={s} variant="outline" nativeButton={false} render={<Link href={`/map/features/new?shape=${s}`} />}>
              + {s === 'point' ? 'Point' : s === 'line' ? 'Line' : 'Shape'}
            </Button>
          ))}
        </div>
        <div className="-mr-2 flex-1 overflow-y-auto pr-2">
          {MAP_LAYERS.map((layer) => {
            const rows = all.filter((f) => FEATURE_KINDS[f.kind].layer === layer.id && matches(f));
            if (rows.length === 0) return null;
            const isOpen = open.has(layer.id) || !!q;
            const swatch = Object.values(FEATURE_KINDS).find((k) => k.layer === layer.id)?.color;
            return (
              <section key={layer.id}>
                <button type="button" aria-expanded={isOpen} onClick={() => setOpen((o) => { const n = new Set(o); if (n.has(layer.id)) n.delete(layer.id); else n.add(layer.id); return n; })}
                  className="flex w-full items-center gap-2.5 py-2 text-left">
                  <span aria-hidden className={cn('text-[10px] text-white/70 transition-transform', isOpen && 'rotate-90')}>▶</span>
                  <span className={cn('size-3 rounded-[3px]', layer.id === 'borders' && 'border-2 border-dashed bg-transparent')} style={layer.id === 'borders' ? { borderColor: swatch } : { background: swatch }} />
                  <span className="flex-1 text-[15px] font-semibold">{LAYER_LABEL[layer.id] ?? layer.label}</span>
                  <span className="text-sm text-white/65">{rows.length}</span>
                </button>
                {isOpen && (
                  <ul className="mb-1 flex flex-col">
                    {rows.map((f) => (
                      <li key={f.id}>
                        <Link href={`/map/features/${encodeURIComponent(f.id)}`} aria-current={f.id === feature?.id ? 'page' : undefined}
                          className={cn('flex items-center gap-2.5 rounded-full py-1.5 pr-2.5 pl-6', f.id === feature?.id ? 'bg-white/14 font-semibold' : 'hover:bg-white/8')}>
                          <KindMark kind={f.kind} />
                          <span className="flex-1 truncate text-[15px]">{f.name || <span className="text-white/55">(no name)</span>}</span>
                          <span className="truncate text-xs text-white/60">{FEATURE_KINDS[f.kind].label}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </aside>

      {editing && (
        <aside className="glass fixed inset-x-2 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 flex max-h-[60svh] flex-col gap-3 overflow-y-auto rounded-[32px] p-5 md:inset-x-auto md:top-auto md:right-28 md:bottom-28 md:w-[340px] md:p-6">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: FEATURE_KINDS[kind].color }} />
            <span className="text-xs font-semibold tracking-[0.08em] text-white/75 uppercase">{feature ? FAMILY_WORD[shape] : `New ${FAMILY_WORD[shape].toLowerCase()}`}</span>
            <div className="flex-1" />
            <RoundButton label="Close" onClick={() => router.push('/map/features')}>×</RoundButton>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="feature-name">Name</Label>
            <Input id="feature-name" value={name} onChange={(e) => touch(setName)(e.target.value)} placeholder={FEATURE_KINDS[kind].label} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="feature-kind">Kind</Label>
            <select id="feature-kind" value={kind} onChange={(e) => touch(setKind)(e.target.value as FeatureKind)}
              className="h-12 w-full rounded-full border border-input bg-field px-4 text-base text-white [&>option]:text-ink">
              {kinds.map((k) => <option key={k} value={k}>{FEATURE_KINDS[k].label}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="feature-description">Description</Label>
            <Textarea id="feature-description" value={description} onChange={(e) => touch(setDescription)(e.target.value)} rows={2} placeholder="What happens here, who to ask…" />
          </div>
          <p className="text-sm text-white/75">
            {HELP[shape]} Kinds can change within {shape === 'point' ? 'points' : shape === 'line' ? 'lines' : 'shapes'}: {kinds.map((k) => FEATURE_KINDS[k].label.toLowerCase()).join(', ')}.
          </p>
          {shape !== 'point' && <ShapeToolRows shape={shape} active={active} onChoose={choose} compact />}
          {error && <p className="text-sm text-[#ff9b91]">{error}</p>}
          {status === 'saved' && <p className="text-sm text-teal">Saved.</p>}
          <div className="flex items-center gap-2">
            <Button onClick={handleSave} disabled={status === 'saving'}>{status === 'saving' ? 'Saving…' : 'Save'}</Button>
            <Button variant="outline" nativeButton={false} render={<Link href="/map/features" />}>Cancel</Button>
            <div className="flex-1" />
            {feature && (
              <button type="button" onClick={handleDelete} className="px-2 py-3 text-[15px] font-semibold text-[#ff8a7a]">
                {status === 'confirm-delete' ? 'Click again to delete' : 'Delete'}
              </button>
            )}
          </div>
        </aside>
      )}
    </>
  );
}
