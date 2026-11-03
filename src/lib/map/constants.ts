// The old static map image, kept as an optional overlay layer (placed by legacy-image.ts).
export const MAP_IMAGE_SRC = '/map/alversjo.jpg';
export const MAP_IMAGE_WIDTH = 1755;
export const MAP_IMAGE_HEIGHT = 2482;

/** Where the map opens, as Leaflet `[lat, lng]`. The farm buildings. */
export const SITE_CENTER: [number, number] = [57.6226, 14.9276];
export const SITE_ZOOM = 16;

/**
 * Generous box around the property, `[west, south, east, north]`. Area geometry outside it
 * is rejected: it almost always means swapped lat/lon or a polygon pasted from elsewhere.
 */
export const SITE_BBOX: [number, number, number, number] = [14.85, 57.58, 15.0, 57.67];

/**
 * Drone orthophoto of the site, July 2026, 5 cm/px. By Ebbe Valbak, CC-BY 4.0, published on
 * OpenAerialMap. Tiles are rendered on demand from the original GeoTIFF.
 */
export const DRONE_2026 = {
  url: 'https://tiles.openaerialmap.org/6a82fe4909bfcbdf0ea094f2/0/6a82fe4909bfcbdf0ea094f3/{z}/{x}/{y}.png',
  // Kept short: on a phone the attribution bar otherwise takes three lines of the map.
  attribution: 'Drone 2026 © Ebbe Valbak, <a href="https://creativecommons.org/licenses/by/4.0/">CC-BY</a>',
  // [[south, west], [north, east]] — no requests are made for tiles outside it.
  bounds: [[57.61466, 14.915173], [57.636085, 14.936187]] as [[number, number], [number, number]],
  maxNativeZoom: 21,
};

export const MAP_MAX_ZOOM = 22;

/**
 * Attribution for the initial map features (migration 0013): taken from the Borderland placement
 * map and the alversjomaps sound guide, with the Borderland team's permission.
 */
export const SITE_LAYERS_ATTRIBUTION = '<a href="https://www.theborderland.se/map/">Borderland map</a>';
