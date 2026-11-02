'use client';

import type { Feature, FeatureCollection } from 'geojson';
import L, { type PathOptions } from 'leaflet';
import { useEffect, useState } from 'react';
import { GeoJSON, LayersControl, Pane } from 'react-leaflet';
import { SITE_LAYERS_ATTRIBUTION, SITE_LAYERS_DIR } from '@/lib/map/constants';

type Layer = {
  name: string;
  file: string;
  checked: boolean;
  filter?: (f: Feature) => boolean;
  style?: (f?: Feature) => PathOptions;
  label?: (f: Feature) => string | undefined;
};

const kind = (f?: Feature) => f?.properties?.kind as string | undefined;
const pointColors: Record<string, string> = {
  venue: '#f97316', water: '#0ea5e9', toilet: '#a855f7', biotope: '#16a34a', flood: '#2563eb', neighbour: '#dc2626',
};
const points = (kinds: string[]) => (f: Feature) => kinds.includes(kind(f) ?? '');

const LAYERS: Layer[] = [
  {
    name: 'Property border', file: 'borders', checked: true,
    style: (f) => kind(f) === 'nature-reserve'
      ? { color: '#4ade80', weight: 2, dashArray: '6 4', fillOpacity: 0.05 }
      : { color: '#facc15', weight: 2, fill: false },
    label: (f) => (kind(f) === 'nature-reserve' ? 'Nature reserve' : undefined),
  },
  { name: 'Buildings', file: 'buildings', checked: false, style: () => ({ color: '#ef4444', weight: 2, fillOpacity: 0.15 }) },
  {
    name: 'Lakes & water protection zone', file: 'water', checked: false,
    style: (f) => kind(f) === 'water-protection'
      ? { color: '#38bdf8', weight: 1, dashArray: '4 4', fillOpacity: 0.08 }
      : { color: '#0284c7', weight: 1, fillOpacity: 0.3 },
    label: (f) => f.properties?.name,
  },
  { name: 'Paths', file: 'paths', checked: false, style: () => ({ color: '#fde68a', weight: 2, opacity: 0.8 }) },
  { name: 'Places (barns, water, toilets)', file: 'points', checked: true, filter: points(['venue', 'water', 'toilet']), label: (f) => f.properties?.name },
  { name: 'Protected biotopes', file: 'points', checked: false, filter: points(['biotope']), label: (f) => f.properties?.name },
  { name: 'Flood-prone spots', file: 'points', checked: false, filter: points(['flood']), label: (f) => f.properties?.name },
  { name: 'Neighbours', file: 'points', checked: false, filter: points(['neighbour']), label: (f) => f.properties?.name },
  {
    name: 'Sound zones', file: 'sound-zones', checked: false,
    style: (f) => ({ color: f?.properties?.color, weight: 1, fillColor: f?.properties?.color, fillOpacity: 0.3 }),
    label: (f) => `Sound class ${f.properties?.soundClass} (${f.properties?.name})`,
  },
];

/** Reference layers as entries in the layer switcher. Each file is fetched once, when the map opens. */
export function SiteLayers() {
  const [data, setData] = useState<Record<string, FeatureCollection>>({});

  useEffect(() => {
    let live = true;
    for (const file of new Set(LAYERS.map((l) => l.file))) {
      fetch(`${SITE_LAYERS_DIR}/${file}.geojson`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (live && d) setData((prev) => ({ ...prev, [file]: d })); })
        .catch(() => {}); // a missing reference layer shouldn't break the map
    }
    return () => { live = false; };
  }, []);

  // Leaflet's default overlay pane (areas) sits at z-index 400: reference shapes go below it so
  // they never cover or catch clicks meant for areas, reference points above it.
  return [
    <Pane key="site-shapes" name="site-shapes" style={{ zIndex: 350 }} />,
    <Pane key="site-points" name="site-points" style={{ zIndex: 450 }} />,
    ...LAYERS.map((layer) => (
    <LayersControl.Overlay key={layer.name} checked={layer.checked} name={layer.name}>
      {/* GeoJSON reads `data` once on mount, so mount it only once the file has loaded. */}
      {data[layer.file] ? (
        <GeoJSON
          data={data[layer.file]}
          pane="site-shapes"
          attribution={SITE_LAYERS_ATTRIBUTION}
          filter={layer.filter}
          style={layer.style}
          pointToLayer={(f, latlng) => L.circleMarker(latlng, {
            pane: 'site-points', radius: 6, color: '#fff', weight: 2, fillColor: pointColors[kind(f) ?? ''] ?? '#666', fillOpacity: 1,
          })}
          onEachFeature={(f, l) => {
            const text = layer.label?.(f);
            if (!text) return;
            // bindTooltip renders strings as HTML; pass an element so names stay plain text.
            const el = document.createElement('span');
            el.textContent = text;
            l.bindTooltip(el);
          }}
        />
      ) : null}
    </LayersControl.Overlay>
    )),
  ];
}
