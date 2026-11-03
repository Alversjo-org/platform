'use client';

import type { Map as LeafletMap } from 'leaflet';
import { GeoJSON } from 'react-leaflet';
import type { MapFeatureData } from '@/lib/map/features';
import type { AreaGeometry } from '@/lib/map/geometry';
import BaseMap from './base-map';
import { ShapeEditorTools, type GeometryReader, type ShapeToolsApi } from './shape-editor-tools';

/** The area editor's map: the drone photo, the border faint, other areas dashed. Browser-only (see BaseMap). */
export default function AreaShapeEditorLeaflet({ initial, others, features, onReady, onChange, onTools, onToolEnd, mapRef }: {
  initial: AreaGeometry | null;
  others: Array<{ id: string; name: string; geometry: AreaGeometry }>;
  features: MapFeatureData[];
  onReady: (read: GeometryReader) => void;
  onChange: () => void;
  onTools: (api: ShapeToolsApi) => void;
  onToolEnd: () => void;
  mapRef: (map: LeafletMap | null) => void;
}) {
  return (
    <BaseMap editable className="alv-map h-full w-full" mapRef={mapRef}
      features={features.filter((f) => f.kind === 'property')} featureOptions={{ interactive: false }}
      layers={{ background: 'drone', oldMap: false, layers: ['borders'] }}>
      {others.map((o) => (
        // Other areas, for reference and snapping-by-eye; not editable.
        <GeoJSON key={o.id} data={o.geometry} interactive={false}
          style={{ color: '#ffffff', weight: 1.5, dashArray: '5 5', opacity: 0.7, fillOpacity: 0.05 }} />
      ))}
      <ShapeEditorTools shape="polygon" initial={initial} onReady={onReady} onChange={onChange} onTools={onTools} onToolEnd={onToolEnd} />
    </BaseMap>
  );
}
