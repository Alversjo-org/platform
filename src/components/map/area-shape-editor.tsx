'use client';

import dynamic from 'next/dynamic';
import { useCallback, useRef, useState } from 'react';
import { saveAreaShapeAction } from '@/app/areas/[id]/shape/actions';
import { Button } from '@/components/ui/button';
import type { AreaGeometry } from '@/lib/map/geometry';
import type { ShapeReader } from './area-shape-editor-leaflet';

const AreaShapeEditorLeaflet = dynamic(() => import('./area-shape-editor-leaflet'), {
  ssr: false,
  loading: () => <div className="h-[70vh] min-h-[400px] w-full animate-pulse rounded-md border bg-muted" />,
});

export function AreaShapeEditor({ areaId, initial, others }: {
  areaId: string;
  initial: AreaGeometry | null;
  others: Array<{ id: string; name: string; geometry: AreaGeometry }>;
}) {
  const readShape = useRef<ShapeReader | null>(null);
  const [status, setStatus] = useState<'clean' | 'dirty' | 'saving' | 'saved'>('clean');
  const [error, setError] = useState<string | null>(null);

  const onReady = useCallback((read: ShapeReader) => { readShape.current = read; }, []);
  const onChange = useCallback(() => { setStatus('dirty'); setError(null); }, []);

  async function handleSave() {
    if (!readShape.current || status === 'saving') return;
    setStatus('saving');
    setError(null);
    const result = await saveAreaShapeAction(areaId, readShape.current()).catch(() => ({ error: 'Could not save — try again.' }));
    if ('error' in result) {
      setError(result.error);
      setStatus('dirty');
    } else {
      setStatus('saved');
    }
  }

  return (
    <div>
      <p className="mb-2 text-sm text-muted-foreground">
        Use the tools on the left to draw a polygon or rectangle, move corners, drag the shape, cut holes, or delete parts.
        Several separate pieces are fine. Deleting everything takes the area off the map (it stays bookable).
      </p>
      <AreaShapeEditorLeaflet initial={initial} others={others} onReady={onReady} onChange={onChange} />
      <div className="mt-4 flex items-center gap-4">
        <Button onClick={handleSave} disabled={status === 'saving'}>{status === 'saving' ? 'Saving…' : 'Save shape'}</Button>
        {status === 'saved' && <span className="text-sm text-muted-foreground">Saved</span>}
        {status === 'dirty' && !error && <span className="text-sm text-muted-foreground">Unsaved changes</span>}
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>
    </div>
  );
}
