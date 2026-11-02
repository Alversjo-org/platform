'use client';

import type { FeatureCollection } from 'geojson';
import L, { type PathOptions } from 'leaflet';
import { GeoJSON, LayersControl, Pane } from 'react-leaflet';
import { SITE_LAYERS_ATTRIBUTION } from '@/lib/map/constants';
import { FEATURE_KINDS, MAP_LAYERS, type FeatureKind } from '@/lib/map/feature-kinds';
import type { MapFeatureData } from '@/lib/map/features';

type Props = { id: string; kind: FeatureKind; name: string; description: string; color?: string };

function style(kind: FeatureKind, color?: string): PathOptions {
  // Leaflet applies `style` to point markers too; theirs is set in pointToLayer, so leave it alone.
  if (FEATURE_KINDS[kind].shape === 'point') return {};
  const c = color ?? FEATURE_KINDS[kind].color;
  switch (kind) {
    case 'property': return { color: c, weight: 2, fill: false };
    case 'nature-reserve': return { color: c, weight: 2, dashArray: '6 4', fillOpacity: 0.05 };
    case 'water-protection': return { color: c, weight: 1, dashArray: '4 4', fillOpacity: 0.08 };
    case 'path': return { color: c, weight: 2, opacity: 0.8 };
    case 'sound-zone': return { color: c, weight: 1, fillColor: c, fillOpacity: 0.3 };
    default: return { color: c, weight: 1, fillOpacity: 0.3 };
  }
}

function popup(p: Props, editable: boolean): HTMLElement {
  // Built with DOM nodes, not an HTML string: names and descriptions are user input.
  const el = document.createElement('div');
  const title = el.appendChild(document.createElement('strong'));
  title.textContent = p.name || FEATURE_KINDS[p.kind].label;
  if (p.name) el.appendChild(document.createElement('div')).textContent = FEATURE_KINDS[p.kind].label;
  if (p.description) el.appendChild(document.createElement('p')).textContent = p.description;
  if (editable) {
    const a = el.appendChild(document.createElement('a'));
    a.href = `/map/features/${encodeURIComponent(p.id)}`;
    a.textContent = 'Edit';
  }
  return el;
}

/**
 * Map features grouped into the layer switcher's overlays. Shapes are drawn below areas (Leaflet's
 * overlay pane is z-index 400) so they never catch clicks meant for an area; points above them.
 */
export function FeatureLayers({ features, editable = false, interactive = true }: {
  features: MapFeatureData[];
  /** Show an Edit link in each feature's popup (mappers). */
  editable?: boolean;
  /** False in editors, where these are background only. */
  interactive?: boolean;
}) {
  return [
    <Pane key="feature-shapes" name="feature-shapes" style={{ zIndex: 350 }} />,
    <Pane key="feature-points" name="feature-points" style={{ zIndex: 450 }} />,
    ...MAP_LAYERS.map((layer) => {
      const data: FeatureCollection = {
        type: 'FeatureCollection',
        features: features
          .filter((f) => FEATURE_KINDS[f.kind].layer === layer.id)
          .map((f) => ({
            type: 'Feature',
            geometry: f.geometry,
            properties: { id: f.id, kind: f.kind, name: f.name, description: f.description, color: typeof f.properties.color === 'string' ? f.properties.color : undefined } satisfies Props,
          })),
      };
      return (
        <LayersControl.Overlay key={layer.id} checked={layer.defaultOn} name={layer.label}>
          <GeoJSON
            // GeoJSON reads `data` only on mount: remount when the features change.
            key={JSON.stringify(data.features.map((f) => f.properties?.id))}
            data={data}
            pane="feature-shapes"
            interactive={interactive}
            attribution={SITE_LAYERS_ATTRIBUTION}
            style={(f) => style(f?.properties.kind, f?.properties.color)}
            pointToLayer={(f, latlng) => L.circleMarker(latlng, {
              pane: 'feature-points', interactive, radius: 6, color: '#fff', weight: 2,
              fillColor: FEATURE_KINDS[f.properties.kind as FeatureKind].color, fillOpacity: 1,
            })}
            onEachFeature={(f, l) => {
              if (!interactive) return;
              const p = f.properties as Props;
              const tip = document.createElement('span');
              tip.textContent = p.name || FEATURE_KINDS[p.kind].label;
              l.bindTooltip(tip);
              l.bindPopup(() => popup(p, editable));
            }}
          />
        </LayersControl.Overlay>
      );
    }),
  ];
}
