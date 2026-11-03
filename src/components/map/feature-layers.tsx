'use client';

import type { FeatureCollection } from 'geojson';
import L, { type PathOptions } from 'leaflet';
import { Fragment } from 'react';
import { GeoJSON, LayersControl, Pane } from 'react-leaflet';
import { SITE_LAYERS_ATTRIBUTION } from '@/lib/map/constants';
import { FEATURE_KINDS, MAP_LAYERS, type FeatureKind, type MapLayerId } from '@/lib/map/feature-kinds';
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
  el.className = 'map-popup';
  const title = el.appendChild(document.createElement('strong'));
  title.className = 'map-popup-title';
  title.textContent = p.name || FEATURE_KINDS[p.kind].label;
  if (p.name) {
    const kind = el.appendChild(document.createElement('div'));
    kind.className = 'map-popup-kind';
    kind.textContent = FEATURE_KINDS[p.kind].label;
  }
  if (p.description) el.appendChild(document.createElement('p')).textContent = p.description;
  if (editable) {
    const a = el.appendChild(document.createElement('a'));
    a.className = 'map-popup-edit';
    a.href = `/map/features/${encodeURIComponent(p.id)}`;
    a.textContent = 'Edit';
  }
  return el;
}

/** The member map starts with every layer off; mappers in the editors need these to work by. */
const EDITOR_DEFAULT_ON: readonly MapLayerId[] = ['borders', 'places'];

/** White icons for point kinds that get a badge instead of a dot; viewBox 0 0 12 15. */
const POINT_ICONS: Partial<Record<FeatureKind, string>> = {
  water: 'M6 0C6 0 .5 6.6.5 10c0 3 2.5 5 5.5 5s5.5-2 5.5-5C11.5 6.6 6 0 6 0Z',
  toilet: 'M0 0h4.5v6H0ZM0 7h12c0 3.2-2 5.2-4.4 5.7l.8 2.3H3l.6-2.5C1.5 11.7 0 9.7 0 7Z',
};

function pointMarker(kind: FeatureKind, latlng: L.LatLng, interactive: boolean, iconSize: number): L.Layer {
  const color = FEATURE_KINDS[kind].color;
  const icon = POINT_ICONS[kind];
  if (!icon) {
    return L.circleMarker(latlng, { pane: 'feature-points', interactive, radius: 6, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 });
  }
  const glyph = Math.round(iconSize * 0.55);
  return L.marker(latlng, {
    pane: 'feature-points',
    interactive,
    keyboard: interactive,
    icon: L.divIcon({
      className: 'map-point-badge',
      iconSize: [iconSize, iconSize],
      html: `<span style="background:${color};width:${iconSize}px;height:${iconSize}px"><svg viewBox="0 0 12 15" width="${glyph}" height="${glyph}" aria-hidden="true"><path fill="#fff" d="${icon}"/></svg></span>`,
    }),
  });
}

/**
 * Map features grouped into the layer switcher's overlays. Shapes are drawn below areas (Leaflet's
 * overlay pane is z-index 400) so they never catch clicks meant for an area; points above them.
 */
export function FeatureLayers({ features, editable = false, interactive = true, visible, iconSize = 22 }: {
  features: MapFeatureData[];
  /** Show an Edit link in each feature's popup (mappers). */
  editable?: boolean;
  /** False in editors, where these are background only. */
  interactive?: boolean;
  /** The layers to draw, without Leaflet's layer switcher. Left out, every layer is an overlay in it. */
  visible?: readonly MapLayerId[];
  /** Diameter of the toilet and water badges. */
  iconSize?: number;
}) {
  return [
    <Pane key="feature-shapes" name="feature-shapes" style={{ zIndex: 350 }} />,
    <Pane key="feature-points" name="feature-points" style={{ zIndex: 450 }} />,
    ...MAP_LAYERS.filter((layer) => !visible || visible.includes(layer.id)).map((layer) => {
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
      const geoJson = (
          <GeoJSON
            // GeoJSON reads `data` only on mount: remount when the features or icon size change.
            key={`${iconSize}:${JSON.stringify(data.features.map((f) => f.properties?.id))}`}
            data={data}
            pane="feature-shapes"
            interactive={interactive}
            attribution={SITE_LAYERS_ATTRIBUTION}
            style={(f) => style(f?.properties.kind, f?.properties.color)}
            pointToLayer={(f, latlng) => pointMarker(f.properties.kind as FeatureKind, latlng, interactive, iconSize)}
            onEachFeature={(f, l) => {
              if (!interactive) return;
              const p = f.properties as Props;
              const tip = document.createElement('span');
              tip.textContent = p.name || FEATURE_KINDS[p.kind].label;
              l.bindTooltip(tip);
              l.bindPopup(() => popup(p, editable));
            }}
          />
      );
      return visible ? <Fragment key={layer.id}>{geoJson}</Fragment> : (
        <LayersControl.Overlay key={layer.id} checked={EDITOR_DEFAULT_ON.includes(layer.id)} name={layer.label}>{geoJson}</LayersControl.Overlay>
      );
    }),
  ];
}
