'use client';

import type { Map as LeafletMap } from 'leaflet';
import type { MapLayerId, ShapeFamily } from '@/lib/map/feature-kinds';
import type { MapFeatureData } from '@/lib/map/features';
import type { FeatureGeometry } from '@/lib/map/geometry';
import BaseMap from './base-map';
import { ShapeEditorTools, type GeometryReader, type ShapeToolsApi } from './shape-editor-tools';

/** What mappers work by (screen 17); the edited feature's own layer is added to these. */
const WORK_LAYERS: MapLayerId[] = ['borders', 'buildings', 'places'];

/**
 * The map features map (screen 17). Browsing, every feature is shown and clickable (popups with
 * Edit). Editing one, the rest are background and the editor tools work on that one.
 * Browser-only (see BaseMap).
 */
export default function FeatureEditorLeaflet({ editing, layer, shape, initial, others, onReady, onChange, onTools, onToolEnd, mapRef }: {
  editing: boolean;
  /** The edited feature's layer, if any. */
  layer: MapLayerId | null;
  shape: ShapeFamily;
  initial: FeatureGeometry | null;
  others: MapFeatureData[];
  onReady: (read: GeometryReader) => void;
  onChange: () => void;
  onTools: (api: ShapeToolsApi) => void;
  onToolEnd: () => void;
  mapRef: (map: LeafletMap | null) => void;
}) {
  return (
    <BaseMap editable={editing} className="alv-map h-full w-full" mapRef={mapRef} features={others}
      featureOptions={{ interactive: !editing, editable: true }} layers={{ background: 'drone', oldMap: false, layers: layer && !WORK_LAYERS.includes(layer) ? [...WORK_LAYERS, layer] : WORK_LAYERS }}>
      {editing && <ShapeEditorTools shape={shape} initial={initial} onReady={onReady} onChange={onChange} onTools={onTools} onToolEnd={onToolEnd} />}
    </BaseMap>
  );
}
