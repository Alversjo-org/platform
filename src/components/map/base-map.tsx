'use client';

import 'leaflet/dist/leaflet.css';
import type { Map as LeafletMap } from 'leaflet';
import type { ReactNode, Ref } from 'react';
import { AttributionControl, ImageOverlay, LayersControl, MapContainer, Pane, ScaleControl, TileLayer } from 'react-leaflet';
import { DRONE_2026, MAP_IMAGE_SRC, MAP_MAX_ZOOM, SITE_CENTER, SITE_ZOOM } from '@/lib/map/constants';
import type { MapLayerId } from '@/lib/map/feature-kinds';
import { legacyImageBounds } from '@/lib/map/legacy-image';
import type { MapFeatureData } from '@/lib/map/features';
import { FeatureLayers } from './feature-layers';

/** What the member map shows, chosen in its Layers panel instead of Leaflet's layer switcher. */
export type MapLayersState = { background: 'drone' | 'street'; oldMap: boolean; layers: MapLayerId[]; iconSize?: number };

const OSM = (
  <TileLayer
    url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    maxNativeZoom={19}
    maxZoom={MAP_MAX_ZOOM}
  />
);
const DRONE = (
  <TileLayer url={DRONE_2026.url} attribution={DRONE_2026.attribution} bounds={DRONE_2026.bounds} maxNativeZoom={DRONE_2026.maxNativeZoom} maxZoom={MAP_MAX_ZOOM} />
);
const OLD_MAP = <ImageOverlay url={MAP_IMAGE_SRC} bounds={legacyImageBounds()} opacity={0.85} pane="legacy-image" />;

/**
 * Leaflet map of the site with the shared background layers. Browser-only: import it through
 * `next/dynamic` with `ssr: false` (Leaflet touches `window` on import).
 *
 * Tiles are fetched only for what is on screen, so the drone layer costs a few MB per view,
 * not the whole 180 MB orthophoto.
 *
 * With `layers`, the caller decides what is shown (the member map's Layers panel) and Leaflet's
 * own zoom buttons and layer switcher are left out. Without it, the editors get the switcher.
 */
export default function BaseMap({ children, className, editable = false, features = [], featureOptions, layers, mapRef }: {
  children?: ReactNode;
  className?: string;
  /** Map features (places, borders, …) shown as overlays. */
  features?: MapFeatureData[];
  featureOptions?: { editable?: boolean; interactive?: boolean };
  /** Lets leaflet-geoman (in opt-in mode, see area-shape-editor-leaflet) attach its tools to this map. */
  editable?: boolean;
  layers?: MapLayersState;
  mapRef?: Ref<LeafletMap>;
}) {
  return (
    <MapContainer
      ref={mapRef}
      center={SITE_CENTER} zoom={SITE_ZOOM} maxZoom={MAP_MAX_ZOOM} className={className} scrollWheelZoom
      zoomControl={!layers} attributionControl={!layers}
      // Quarter steps let "the land" fill the screen instead of snapping a whole level out.
      zoomSnap={layers ? 0.25 : 1}
      {...(editable ? { pmIgnore: false } : {})}
    >
      {/* Above the tiles (200), below reference shapes (350) and areas (400). */}
      <Pane name="legacy-image" style={{ zIndex: 300 }} />
      {layers ? (
        <>
          {OSM}
          {layers.background === 'drone' && DRONE}
          {layers.oldMap && OLD_MAP}
          <FeatureLayers features={features} {...featureOptions} visible={layers.layers} iconSize={layers.iconSize} />
          {/* The drone photo is CC-BY and OpenStreetMap ODbL: the credits must stay visible. */}
          <AttributionControl position="bottomright" prefix={false} />
          <ScaleControl position="bottomleft" imperial={false} />
        </>
      ) : (
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="OpenStreetMap">{OSM}</LayersControl.BaseLayer>
          <LayersControl.Overlay checked name="Drone photo 2026">{DRONE}</LayersControl.Overlay>
          <LayersControl.Overlay name="Old property map">{OLD_MAP}</LayersControl.Overlay>
          <FeatureLayers features={features} {...featureOptions} />
        </LayersControl>
      )}
      {children}
    </MapContainer>
  );
}
