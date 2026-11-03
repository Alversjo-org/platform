'use client';

import type { Map as LeafletMap } from 'leaflet';
import { CircleMarker, GeoJSON, Tooltip, useMapEvents } from 'react-leaflet';
import type { MapFeatureData } from '@/lib/map/features';
import type { MapAreaData } from '@/lib/map/view-model';
import BaseMap, { type MapLayersState } from './base-map';

/** Close in, the toilet and water badges grow from 22 to 28 px. */
function ZoomWatcher({ onZoom }: { onZoom: (zoom: number) => void }) {
  useMapEvents({ zoomend: (e) => onZoom(e.target.getZoom()) });
  return null;
}

/** The member-facing map: every area with an outline, clickable. Browser-only (see BaseMap). */
export default function MapViewLeaflet({ areas, features, canEditFeatures, selectedId, onSelect, layers, areasOn, quietAreas, mapRef, onZoom }: {
  areas: MapAreaData[];
  features: MapFeatureData[];
  canEditFeatures: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  layers: MapLayersState;
  /** The Areas toggle in the Layers panel. */
  areasOn: boolean;
  /** Outlines only, so filled layers under them (sound zones) stay readable. */
  quietAreas: boolean;
  mapRef: (map: LeafletMap | null) => void;
  onZoom: (zoom: number) => void;
}) {
  return (
    <BaseMap className="alv-map h-full w-full" features={features} featureOptions={{ editable: canEditFeatures }} layers={layers} mapRef={mapRef}>
      <ZoomWatcher onZoom={onZoom} />
      {areasOn && areas.map((area) => {
        const selected = selectedId === area.id;
        return (
          <GeoJSON
            // Re-mount when the look changes so the style is re-applied.
            key={`${area.id}:${selected}:${quietAreas}`}
            data={area.geometry}
            style={selected
              ? { color: '#fff', weight: 3, fillColor: area.color, fillOpacity: quietAreas ? 0 : 0.45 }
              : { color: area.color, weight: 1.5, fillColor: area.color, fillOpacity: quietAreas ? 0 : 0.18 }}
            eventHandlers={{ click: () => onSelect(area.id) }}
          />
        );
      })}
      {areasOn && areas.map((area) => (
        <CircleMarker key={`label-${area.id}:${selectedId === area.id}`} center={area.label} radius={0} stroke={false} interactive={false}>
          <Tooltip permanent direction="center" className={selectedId === area.id ? 'map-area-chip is-selected' : 'map-area-chip'}>
            <span className="map-area-chip-dot" style={{ background: area.color }} />
            {area.name}
          </Tooltip>
        </CircleMarker>
      ))}
    </BaseMap>
  );
}
