'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';
import { deleteMapFeatureAction, saveMapFeatureAction } from '@/app/map/features/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FEATURE_KINDS, kindsForShape, type FeatureKind, type ShapeFamily } from '@/lib/map/feature-kinds';
import type { MapFeatureData } from '@/lib/map/features';
import type { GeometryReader } from './shape-editor-tools';

const FeatureEditorLeaflet = dynamic(() => import('./feature-editor-leaflet'), {
  ssr: false,
  loading: () => <div className="h-[60vh] min-h-[360px] w-full animate-pulse rounded-md border bg-muted" />,
});

const HELP: Record<ShapeFamily, string> = {
  point: 'Click the map to place the point, or drag it to move it.',
  line: 'Use the tools on the left to draw a line, move its corners, drag it, or delete parts.',
  polygon: 'Use the tools on the left to draw a shape, move corners, drag it, cut holes, or delete parts.',
};

/** Create (feature null) or edit a map feature: name, kind, description and its place on the map. */
export function FeatureEditor({ feature, shape, others }: {
  feature: MapFeatureData | null;
  shape: ShapeFamily;
  others: MapFeatureData[];
}) {
  const router = useRouter();
  const readGeometry = useRef<GeometryReader | null>(null);
  const kinds = kindsForShape(shape);
  const [kind, setKind] = useState<FeatureKind>(feature?.kind ?? kinds[0]);
  const [name, setName] = useState(feature?.name ?? '');
  const [description, setDescription] = useState(feature?.description ?? '');
  const [status, setStatus] = useState<'clean' | 'dirty' | 'saving' | 'saved' | 'confirm-delete'>('clean');
  const [error, setError] = useState<string | null>(null);

  const onReady = useCallback((read: GeometryReader) => { readGeometry.current = read; }, []);
  const onChange = useCallback(() => { setStatus('dirty'); setError(null); }, []);
  const touch = <T,>(set: (v: T) => void) => (v: T) => { set(v); onChange(); };

  async function handleSave() {
    if (status === 'saving') return;
    setStatus('saving');
    setError(null);
    const result = await saveMapFeatureAction(feature?.id ?? null, {
      kind, name, description, geometry: readGeometry.current?.() ?? null,
    }).catch(() => ({ error: 'Could not save — try again.' }));
    if ('error' in result) {
      setError(result.error);
      setStatus('dirty');
      return;
    }
    setStatus('saved');
    if (!feature) router.replace(`/map/features/${result.id}`);
  }

  async function handleDelete() {
    if (!feature) return;
    if (status !== 'confirm-delete') { setStatus('confirm-delete'); return; }
    await deleteMapFeatureAction(feature.id);
    router.push('/map/features');
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="feature-name">Name</Label>
          <Input id="feature-name" value={name} onChange={(e) => touch(setName)(e.target.value)} placeholder={FEATURE_KINDS[kind].label} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="feature-kind">Kind</Label>
          <select
            id="feature-kind"
            value={kind}
            onChange={(e) => touch(setKind)(e.target.value as FeatureKind)}
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
          >
            {kinds.map((k) => <option key={k} value={k}>{FEATURE_KINDS[k].label}</option>)}
          </select>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="feature-description">Description</Label>
        <Textarea id="feature-description" value={description} onChange={(e) => touch(setDescription)(e.target.value)} rows={2} />
      </div>
      <p className="text-sm text-muted-foreground">{HELP[shape]}</p>
      <FeatureEditorLeaflet shape={shape} initial={feature?.geometry ?? null} others={others} onReady={onReady} onChange={onChange} />
      <div className="flex flex-wrap items-center gap-4">
        <Button onClick={handleSave} disabled={status === 'saving'}>{status === 'saving' ? 'Saving…' : 'Save'}</Button>
        {feature && (
          <Button variant="destructive" onClick={handleDelete}>
            {status === 'confirm-delete' ? 'Click again to delete' : 'Delete'}
          </Button>
        )}
        {status === 'saved' && <span className="text-sm text-muted-foreground">Saved</span>}
        {status === 'dirty' && !error && <span className="text-sm text-muted-foreground">Unsaved changes</span>}
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>
    </div>
  );
}
