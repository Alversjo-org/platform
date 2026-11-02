import { MAP_IMAGE_HEIGHT, MAP_IMAGE_WIDTH } from './constants';

/**
 * Georeference of the old static map image (`public/map/alversjo.jpg`, a QGIS export).
 *
 * Affine transform from image pixels (x right, y down) to WGS84 [lon, lat]. Fitted on
 * 2026-11-02 by matching the red building outlines in the image to the building polygons
 * in the Borderland map's `public/data/drawnmap/buildings.geojson`
 * (github.com/theborderland/map): 12 matched buildings, RMS residual 3.7 m. Scale comes out
 * at 1.152 m/px east-west and 1.149 m/px north-south with negligible rotation, which is what
 * a north-up QGIS export should give.
 *
 * Only used to (a) convert grid cells and seed polygons that were drawn on the image into
 * real coordinates, and (b) place the image as an optional overlay layer on the map.
 */
const T = [
  0.00001932304827366211, -6.3365598701544685e-9, 14.910329725210264,
  -1.3969008835592403e-8, -0.000010322341025228353, 57.63900431456313,
] as const;

export function imagePixelToLonLat(x: number, y: number): [number, number] {
  return [T[0] * x + T[1] * y + T[2], T[3] * x + T[4] * y + T[5]];
}

/** Same as `imagePixelToLonLat`, for coordinates given as fractions (0–1) of the image size. */
export function imageFractionToLonLat(fx: number, fy: number): [number, number] {
  return imagePixelToLonLat(fx * MAP_IMAGE_WIDTH, fy * MAP_IMAGE_HEIGHT);
}

/**
 * The image's south-west and north-east corners as Leaflet `[lat, lng]` pairs, for an
 * `imageOverlay`. Leaflet can only place images north-up; the fitted rotation is under
 * 0.1 px across the whole image, so that loses nothing.
 */
export function legacyImageBounds(): [[number, number], [number, number]] {
  const [west, north] = imageFractionToLonLat(0, 0);
  const [east, south] = imageFractionToLonLat(1, 1);
  return [[south, west], [north, east]];
}
