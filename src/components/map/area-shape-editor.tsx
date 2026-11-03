'use client';

import type { Map as LeafletMap } from 'leaflet';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';
import { saveAreaShapeAction } from '@/app/areas/[id]/shape/actions';
import { Button } from '@/components/ui/button';
import { DRONE_2026 } from '@/lib/map/constants';
import type { MapFeatureData } from '@/lib/map/features';
import { hectares, splitPolygons, type AreaGeometry } from '@/lib/map/geometry';
import { ZoomButtons } from './map-controls';
import { ShapeToolRows } from './shape-tool-rows';
import type { GeometryReader, ShapeTool, ShapeToolsApi } from './shape-editor-tools';

const AreaShapeEditorLeaflet = dynamic(() => import('./area-shape-editor-leaflet'), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-night/40" />,
});


function stats(g: AreaGeometry | null) {
  if (!g) return { pieces: 0, corners: 0, ha: 0 };
  const polys = splitPolygons(g);
  // Rings repeat their first corner at the end.
  const corners = polys.reduce((n, rings) => n + rings.reduce((m, r) => m + r.length - 1, 0), 0);
  return { pieces: polys.length, corners, ha: Math.round(hectares(g) * 10) / 10 };
}

/** Screen 16: the outline editor, full screen under the nav, with its tools in a panel. */
export function AreaShapeEditor({ areaId, areaName, initial, others, features }: {
  areaId: string;
  areaName: string;
  initial: AreaGeometry | null;
  others: Array<{ id: string; name: string; geometry: AreaGeometry }>;
  features: MapFeatureData[];
}) {
  const router = useRouter();
  const readShape = useRef<GeometryReader | null>(null);
  const tools = useRef<ShapeToolsApi | null>(null);
  const [map, setMap] = useState<LeafletMap | null>(null);
  const [active, setActive] = useState<ShapeTool | null>(null);
  const [shape, setShape] = useState(() => stats(initial));
  const [status, setStatus] = useState<'clean' | 'dirty' | 'saving'>('clean');
  const [error, setError] = useState<string | null>(null);
  const back = `/map?area=${encodeURIComponent(areaId)}`;

  const onReady = useCallback((read: GeometryReader) => { readShape.current = read; }, []);
  const onChange = useCallback(() => {
    setStatus('dirty');
    setError(null);
    setShape(stats((readShape.current?.() as AreaGeometry | null) ?? null));
  }, []);
  const onTools = useCallback((api: ShapeToolsApi) => { tools.current = api; }, []);
  const onToolEnd = useCallback(() => setActive((t) => (t === 'draw' || t === 'rectangle' || t === 'cut' ? null : t)), []);
  const choose = (tool: ShapeTool) => {
    const next = active === tool ? null : tool;
    tools.current?.use(next);
    setActive(next);
  };

  async function handleSave() {
    if (!readShape.current || status === 'saving') return;
    tools.current?.use(null);
    setActive(null);
    setStatus('saving');
    setError(null);
    const result = await saveAreaShapeAction(areaId, readShape.current()).catch(() => ({ error: 'Could not save. Try again.' }));
    if ('error' in result) {
      setError(result.error);
      setStatus('dirty');
    } else {
      router.push(back);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-0">
        <AreaShapeEditorLeaflet initial={initial} others={others} features={features} onReady={onReady} onChange={onChange}
          onTools={onTools} onToolEnd={onToolEnd} mapRef={setMap} />
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[401] h-40 bg-linear-to-b from-[#0b1a33]/60 to-transparent" />
      </div>

      <ZoomButtons map={map} home={() => map?.fitBounds(DRONE_2026.bounds)} className="fixed right-10 bottom-28 z-30 hidden md:flex" />

      <aside className="glass fixed inset-x-2 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 flex max-h-[48svh] flex-col gap-3 overflow-y-auto rounded-[32px] p-5 md:inset-x-auto md:top-[124px] md:bottom-auto md:left-10 md:max-h-[calc(100svh-10rem)] md:w-[360px] md:p-6">
        <Link href="/areas" className="self-start py-1 text-[15px] text-white/85">← Areas</Link>
        <div>
          <h1 className="font-serif text-[32px] leading-tight font-bold">{areaName}</h1>
          <p className="text-[15px] text-white/75">Outline on the map</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[`${shape.pieces} ${shape.pieces === 1 ? 'piece' : 'pieces'}`, `${shape.corners} corners`, `${shape.ha.toLocaleString('sv-SE')} ha`].map((t) => (
            <span key={t} className="rounded-full bg-white/14 px-2.5 py-1 text-xs font-semibold">{t}</span>
          ))}
        </div>
        <h2 className="mt-1 text-xs font-semibold tracking-[0.08em] text-white/70 uppercase">Tools</h2>
        <ShapeToolRows shape="polygon" active={active} onChoose={choose} />
        <p className="text-sm text-white/75">
          Several pieces make one area. Other areas and the border are shown for reference; they can’t be changed here.
          Removing every piece takes the area off the map (it stays bookable).
        </p>
        {error && <p className="text-sm text-[#ff9b91]">{error}</p>}
        <div className="flex gap-2">
          <Button size="lg" className="flex-1" onClick={handleSave} disabled={status === 'saving'}>{status === 'saving' ? 'Saving…' : 'Save outline'}</Button>
          <Button size="lg" variant="outline" nativeButton={false} render={<Link href={back} />}>Cancel</Button>
        </div>
      </aside>
    </>
  );
}
