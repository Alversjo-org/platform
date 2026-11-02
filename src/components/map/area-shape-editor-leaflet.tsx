'use client';

import { GeoJSON } from 'react-leaflet';
import type { MapFeatureData } from '@/lib/map/features';
import type { AreaGeometry } from '@/lib/map/geometry';
import BaseMap from './base-map';
import { ShapeEditorTools, type GeometryReader } from './shape-editor-tools';

/** The area editor's map. Browser-only (see BaseMap). */
export default function AreaShapeEditorLeaflet({ initial, others, features, onReady, onChange }: {
  initial: AreaGeometry | null;
  others: Array<{ id: string; name: string; geometry: AreaGeometry }>;
  features: MapFeatureData[];
  onReady: (read: GeometryReader) => void;
  onChange: () => void;
}) {
  return (
    <BaseMap editable className="h-[70vh] min-h-[400px] w-full rounded-md border" features={features} featureOptions={{ interactive: false }}>
      {others.map((o) => (
        // Other areas, for reference and snapping-by-eye; not editable.
        <GeoJSON key={o.id} data={o.geometry} interactive={false}
          style={{ color: '#ffffff', weight: 1, dashArray: '4 4', fillOpacity: 0.08 }} />
      ))}
      <ShapeEditorTools shape="polygon" initial={initial} onReady={onReady} onChange={onChange} />
    </BaseMap>
  );
}
