'use client';

import './leaflet-global';
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import type { LineString, MultiLineString, Position } from 'geojson';
import L from 'leaflet';
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import type { ShapeFamily } from '@/lib/map/feature-kinds';
import { combineLines, combinePolygons, splitPolygons, type AreaGeometry, type FeatureGeometry } from '@/lib/map/geometry';

export type GeometryReader = () => FeatureGeometry | null;

// Opt-in: geoman only manages maps and layers created with `pmIgnore: false` (the shape being
// edited) and what it draws itself, never background layers. Global, but this module is only
// loaded by the editors.
L.PM.setOptIn(true);

const EDIT_STYLE = { color: '#2563eb', weight: 3 };

function initialLayers(shape: ShapeFamily, initial: FeatureGeometry | null): L.Layer[] {
  if (!initial) return [];
  const ll = ([lon, lat]: Position) => L.latLng(lat, lon);
  if (shape === 'point' && initial.type === 'Point') {
    return [L.marker(ll(initial.coordinates), { draggable: true, icon: pointIcon() })];
  }
  if (shape === 'line' && (initial.type === 'LineString' || initial.type === 'MultiLineString')) {
    const lines = initial.type === 'LineString' ? [initial.coordinates] : initial.coordinates;
    return lines.map((line) => L.polyline(line.map(ll), EDIT_STYLE));
  }
  if (shape === 'polygon' && (initial.type === 'Polygon' || initial.type === 'MultiPolygon')) {
    return splitPolygons(initial).map((rings) => L.polygon(rings.map((r) => r.slice(0, -1).map(ll)), EDIT_STYLE));
  }
  return [];
}

function pointIcon(): L.DivIcon {
  // A CSS dot instead of Leaflet's default marker image (whose URLs break under bundlers).
  return L.divIcon({ className: 'map-edit-point', iconSize: [18, 18] });
}

/** Points: one draggable marker; clicking the map moves it there (or places it, for a new point). */
function usePointEditor(map: L.Map, initial: FeatureGeometry | null, onReady: (r: GeometryReader) => void, onChange: () => void) {
  useEffect(() => {
    let marker = initialLayers('point', initial)[0] as L.Marker | undefined;
    const place = (latlng: L.LatLng) => {
      if (marker) marker.setLatLng(latlng);
      else marker = L.marker(latlng, { draggable: true, icon: pointIcon() }).addTo(map).on('dragend', onChange);
      onChange();
    };
    if (marker) {
      marker.addTo(map).on('dragend', onChange);
      map.setView(marker.getLatLng(), Math.max(map.getZoom(), 18));
    }
    const onClick = (e: L.LeafletMouseEvent) => place(e.latlng);
    map.on('click', onClick);
    map.getContainer().style.cursor = 'crosshair';
    onReady(() => {
      if (!marker) return null;
      const { lat, lng } = marker.getLatLng();
      return { type: 'Point', coordinates: [lng, lat] };
    });
    return () => {
      map.off('click', onClick);
      map.getContainer().style.cursor = '';
      marker?.remove();
    };
  }, [map, initial, onReady, onChange]);
}

/** Lines and polygons: geoman's draw/edit/drag/cut/remove tools. */
function useShapeEditor(map: L.Map, shape: 'line' | 'polygon', initial: FeatureGeometry | null, onReady: (r: GeometryReader) => void, onChange: () => void) {
  useEffect(() => {
    // Tracked here rather than asked from geoman: in opt-in mode geoman leaves shapes it draws or
    // cuts out of its own layer lists.
    const shapes = new Set<L.Polyline>();
    const wanted = (l: L.Layer): l is L.Polyline => (shape === 'polygon' ? l instanceof L.Polygon : l instanceof L.Polyline && !(l instanceof L.Polygon));
    const track = (layer: L.Layer) => {
      if (!wanted(layer)) return;
      layer.options.pmIgnore = false;
      L.PM.reInitLayer(layer); // so edit/drag/cut/remove modes apply to it
      layer.on('pm:edit pm:dragend', onChange);
      shapes.add(layer);
    };
    for (const l of initialLayers(shape, initial)) track(l.addTo(map));

    map.pm.addControls({
      position: 'topleft',
      drawMarker: false, drawCircleMarker: false, drawCircle: false, drawText: false,
      drawPolyline: shape === 'line', drawPolygon: shape === 'polygon', drawRectangle: shape === 'polygon', cutPolygon: shape === 'polygon',
      editMode: true, dragMode: true, removalMode: true, rotateMode: false,
    });
    map.pm.setPathOptions(EDIT_STYLE);
    map.pm.setGlobalOptions({ snappable: true, snapDistance: 15 });
    if (shapes.size > 0) map.fitBounds(L.featureGroup([...shapes]).getBounds(), { padding: [40, 40], maxZoom: 19 });

    const onCreate = (e: { layer: L.Layer }) => { track(e.layer); onChange(); };
    const onRemove = (e: { layer: L.Layer }) => { shapes.delete(e.layer as L.Polyline); onChange(); };
    const onCut = (e: { layer: L.Layer; originalLayer: L.Layer }) => {
      shapes.delete(e.originalLayer as L.Polyline);
      track(e.layer);
      onChange();
    };
    map.on('pm:create', onCreate);
    map.on('pm:remove', onRemove);
    map.on('pm:cut', onCut);

    onReady(() => {
      const geoms = [...shapes].filter((l) => map.hasLayer(l)).map((l) => l.toGeoJSON(7).geometry);
      if (geoms.length === 0) return null;
      if (shape === 'polygon') return combinePolygons(geoms.flatMap((g) => splitPolygons(g as unknown as AreaGeometry)));
      return combineLines(geoms.flatMap((g) => {
        const line = g as LineString | MultiLineString;
        return line.type === 'LineString' ? [line.coordinates] : line.coordinates;
      }));
    });

    return () => {
      map.off('pm:create', onCreate);
      map.off('pm:remove', onRemove);
      map.off('pm:cut', onCut);
      map.pm.removeControls();
      shapes.forEach((l) => l.remove());
    };
  }, [map, shape, initial, onReady, onChange]);
}

/**
 * Editing tools for one geometry, rendered inside a `<BaseMap editable>`. Reports a reader via
 * `onReady` (call it on save) and calls `onChange` on every edit.
 */
export function ShapeEditorTools({ shape, initial, onReady, onChange }: {
  shape: ShapeFamily;
  initial: FeatureGeometry | null;
  onReady: (read: GeometryReader) => void;
  onChange: () => void;
}) {
  const map = useMap();
  return shape === 'point'
    ? <PointTools map={map} initial={initial} onReady={onReady} onChange={onChange} />
    : <PathTools map={map} shape={shape} initial={initial} onReady={onReady} onChange={onChange} />;
}

function PointTools(p: { map: L.Map; initial: FeatureGeometry | null; onReady: (r: GeometryReader) => void; onChange: () => void }) {
  usePointEditor(p.map, p.initial, p.onReady, p.onChange);
  return null;
}

function PathTools(p: { map: L.Map; shape: 'line' | 'polygon'; initial: FeatureGeometry | null; onReady: (r: GeometryReader) => void; onChange: () => void }) {
  useShapeEditor(p.map, p.shape, p.initial, p.onReady, p.onChange);
  return null;
}
