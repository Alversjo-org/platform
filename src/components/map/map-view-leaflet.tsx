'use client';

import { CircleMarker, GeoJSON, Tooltip } from 'react-leaflet';
import type { MapFeatureData } from '@/lib/map/features';
import type { MapAreaData } from '@/lib/map/view-model';
import BaseMap from './base-map';

/** The member-facing map: every area with an outline, clickable. Browser-only (see BaseMap). */
export default function MapViewLeaflet({ areas, features, canEditFeatures, selectedId, onSelect }: {
  areas: MapAreaData[];
  features: MapFeatureData[];
  canEditFeatures: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <BaseMap className="h-[70vh] min-h-[400px] w-full rounded-md border" features={features} featureOptions={{ editable: canEditFeatures }}>
      {areas.map((area) => (
        <GeoJSON
          // Re-mount when selection changes so the style is re-applied.
          key={`${area.id}:${selectedId === area.id}`}
          data={area.geometry}
          style={{ color: area.color, weight: 2, fillColor: area.color, fillOpacity: selectedId === area.id ? 0.5 : 0.25 }}
          eventHandlers={{ click: () => onSelect(area.id) }}
        />
      ))}
      {areas.map((area) => (
        <CircleMarker key={`label-${area.id}`} center={area.label} radius={0} stroke={false} interactive={false}>
          <Tooltip permanent direction="center" className="map-area-label">{area.name}</Tooltip>
        </CircleMarker>
      ))}
    </BaseMap>
  );
}
