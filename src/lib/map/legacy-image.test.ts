import { describe, expect, it } from 'vitest';
import { imagePixelToLonLat, legacyImageBounds } from './legacy-image';

// Metres between two [lon, lat] points (equirectangular; fine over a few km).
function metres(a: [number, number], b: [number, number]): number {
  const k = Math.cos((57.62 * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * 111320 * k, (a[1] - b[1]) * 111320);
}

describe('legacy image georeference', () => {
  // Building centres: red outline in alversjo.jpg (pixels) vs. the Borderland map's buildings.geojson.
  const controlPoints: Array<[string, [number, number], [number, number]]> = [
    ['long barn', [804.0, 1671.3], [14.925794, 57.6218065]],
    ['building north of the farm', [740.5, 1464.2], [14.9246361, 57.6238744]],
    ['house by the northern road', [611.8, 707.1], [14.9221426, 57.6316998]],
    ['house at the northern gate', [377.7, 109.1], [14.9176339, 57.6378773]],
  ];

  it.each(controlPoints)('puts the %s within 10 m of its real position', (_name, [x, y], real) => {
    expect(metres(imagePixelToLonLat(x, y), real)).toBeLessThan(10);
  });

  it('gives Leaflet bounds as [[south, west], [north, east]] around the site', () => {
    const [[south, west], [north, east]] = legacyImageBounds();
    expect(south).toBeLessThan(north);
    expect(west).toBeLessThan(east);
    expect(south).toBeLessThan(57.6226);
    expect(north).toBeGreaterThan(57.6226);
    expect(west).toBeLessThan(14.9276);
    expect(east).toBeGreaterThan(14.9276);
  });
});
