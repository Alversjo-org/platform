'use client';

import './leaflet-global';
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import L from 'leaflet';
import { useEffect } from 'react';
import { GeoJSON, useMap } from 'react-leaflet';
import { combinePolygons, splitPolygons, type AreaGeometry } from '@/lib/map/geometry';
import BaseMap from './base-map';

export type ShapeReader = () => AreaGeometry | null;

// Opt-in: geoman only manages the map and layers created with `pmIgnore: false` (the edited area's polygons)
// and what it draws itself, never the background layers or other areas. Global, but this module
// is only loaded by the area editor.
L.PM.setOptIn(true);

/**
 * Draw/edit tools for one area's outline.
 */
function Editor({ initial, onReady, onChange }: {
  initial: AreaGeometry | null;
  onReady: (read: ShapeReader) => void;
  onChange: () => void;
}) {
  const map = useMap();

  useEffect(() => {
    // The area's polygons, tracked here rather than asked from geoman: in opt-in mode geoman
    // leaves shapes it draws or cuts out of its own layer lists.
    const shapes = new Set<L.Polygon>();
    const changed = () => onChange();
    const track = (layer: L.Layer) => {
      if (!(layer instanceof L.Polygon)) return;
      layer.options.pmIgnore = false;
      L.PM.reInitLayer(layer); // so edit/drag/cut/remove modes apply to it
      layer.on('pm:edit pm:dragend', changed);
      shapes.add(layer);
    };

    for (const rings of initial ? splitPolygons(initial) : []) {
      const latLngs = rings.map((ring) => ring.slice(0, -1).map(([lon, lat]) => L.latLng(lat, lon)));
      track(L.polygon(latLngs, { color: '#2563eb', weight: 2 }).addTo(map));
    }

    map.pm.addControls({
      position: 'topleft',
      drawMarker: false, drawCircleMarker: false, drawPolyline: false, drawCircle: false, drawText: false,
      drawPolygon: true, drawRectangle: true, editMode: true, dragMode: true, cutPolygon: true, removalMode: true, rotateMode: false,
    });
    map.pm.setPathOptions({ color: '#2563eb', weight: 2 });
    map.pm.setGlobalOptions({ snappable: true, snapDistance: 15 });
    if (shapes.size > 0) map.fitBounds(L.featureGroup([...shapes]).getBounds(), { padding: [40, 40], maxZoom: 19 });

    const onCreate = (e: { layer: L.Layer }) => { track(e.layer); changed(); };
    const onRemove = (e: { layer: L.Layer }) => { shapes.delete(e.layer as L.Polygon); changed(); };
    const onCut = (e: { layer: L.Layer; originalLayer: L.Layer }) => {
      shapes.delete(e.originalLayer as L.Polygon);
      track(e.layer);
      changed();
    };
    map.on('pm:create', onCreate);
    map.on('pm:remove', onRemove);
    map.on('pm:cut', onCut);

    onReady(() => {
      const polygons = [...shapes]
        .filter((l) => map.hasLayer(l))
        .flatMap((l) => splitPolygons(l.toGeoJSON(7).geometry as AreaGeometry));
      return polygons.length > 0 ? combinePolygons(polygons) : null;
    });

    return () => {
      map.off('pm:create', onCreate);
      map.off('pm:remove', onRemove);
      map.off('pm:cut', onCut);
      map.pm.removeControls();
      shapes.forEach((l) => l.remove());
    };
  }, [map, initial, onReady, onChange]);

  return null;
}

/** The area editor's map. Browser-only (see BaseMap). */
export default function AreaShapeEditorLeaflet({ initial, others, onReady, onChange }: {
  initial: AreaGeometry | null;
  others: Array<{ id: string; name: string; geometry: AreaGeometry }>;
  onReady: (read: ShapeReader) => void;
  onChange: () => void;
}) {
  return (
    <BaseMap editable className="h-[70vh] min-h-[400px] w-full rounded-md border">
      {others.map((o) => (
        // Other areas, for reference and snapping-by-eye; not editable.
        <GeoJSON key={o.id} data={o.geometry} interactive={false}
          style={{ color: '#ffffff', weight: 1, dashArray: '4 4', fillOpacity: 0.08 }} />
      ))}
      <Editor initial={initial} onReady={onReady} onChange={onChange} />
    </BaseMap>
  );
}
