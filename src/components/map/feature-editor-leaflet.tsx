'use client';

import type { ShapeFamily } from '@/lib/map/feature-kinds';
import type { MapFeatureData } from '@/lib/map/features';
import type { FeatureGeometry } from '@/lib/map/geometry';
import BaseMap from './base-map';
import { ShapeEditorTools, type GeometryReader } from './shape-editor-tools';

/** The map feature editor's map. Browser-only (see BaseMap). */
export default function FeatureEditorLeaflet({ shape, initial, others, onReady, onChange }: {
  shape: ShapeFamily;
  initial: FeatureGeometry | null;
  others: MapFeatureData[];
  onReady: (read: GeometryReader) => void;
  onChange: () => void;
}) {
  return (
    <BaseMap editable className="h-[60vh] min-h-[360px] w-full rounded-md border" features={others} featureOptions={{ interactive: false }}>
      <ShapeEditorTools shape={shape} initial={initial} onReady={onReady} onChange={onChange} />
    </BaseMap>
  );
}
