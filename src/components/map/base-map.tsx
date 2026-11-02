'use client';

import 'leaflet/dist/leaflet.css';
import type { ReactNode } from 'react';
import { ImageOverlay, LayersControl, MapContainer, Pane, TileLayer } from 'react-leaflet';
import { DRONE_2026, MAP_IMAGE_SRC, MAP_MAX_ZOOM, SITE_CENTER, SITE_ZOOM } from '@/lib/map/constants';
import { legacyImageBounds } from '@/lib/map/legacy-image';
import type { MapFeatureData } from '@/lib/map/features';
import { FeatureLayers } from './feature-layers';

/**
 * Leaflet map of the site with the shared background layers. Browser-only: import it through
 * `next/dynamic` with `ssr: false` (Leaflet touches `window` on import).
 *
 * Tiles are fetched only for what is on screen, so the drone layer costs a few MB per view,
 * not the whole 180 MB orthophoto.
 */
export default function BaseMap({ children, className, editable = false, features = [], featureOptions }: {
  children?: ReactNode;
  className?: string;
  /** Map features (places, borders, …) shown as overlays in the layer switcher. */
  features?: MapFeatureData[];
  featureOptions?: { editable?: boolean; interactive?: boolean };
  /** Lets leaflet-geoman (in opt-in mode, see area-shape-editor-leaflet) attach its tools to this map. */
  editable?: boolean;
}) {
  return (
    <MapContainer
      center={SITE_CENTER} zoom={SITE_ZOOM} maxZoom={MAP_MAX_ZOOM} className={className} scrollWheelZoom
      {...(editable ? { pmIgnore: false } : {})}
    >
      {/* Above the tiles (200), below reference shapes (350) and areas (400). */}
      <Pane name="legacy-image" style={{ zIndex: 300 }} />
      <LayersControl position="topright">
        <LayersControl.BaseLayer checked name="OpenStreetMap">
          <TileLayer
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            maxNativeZoom={19}
            maxZoom={MAP_MAX_ZOOM}
          />
        </LayersControl.BaseLayer>
        <LayersControl.Overlay checked name="Drone photo 2026">
          <TileLayer
            url={DRONE_2026.url}
            attribution={DRONE_2026.attribution}
            bounds={DRONE_2026.bounds}
            maxNativeZoom={DRONE_2026.maxNativeZoom}
            maxZoom={MAP_MAX_ZOOM}
          />
        </LayersControl.Overlay>
        <LayersControl.Overlay name="Old property map">
          <ImageOverlay url={MAP_IMAGE_SRC} bounds={legacyImageBounds()} opacity={0.85} pane="legacy-image" />
        </LayersControl.Overlay>
        <FeatureLayers features={features} {...featureOptions} />
      </LayersControl>
      {children}
    </MapContainer>
  );
}
