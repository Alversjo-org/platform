import cleanCoords from '@turf/clean-coords';
import { featureCollection, polygon } from '@turf/helpers';
import pointOnFeature from '@turf/point-on-feature';
import union from '@turf/union';
import type { LineString, MultiLineString, MultiPolygon, Point, Polygon, Position } from 'geojson';
import { GRID_COLS, GRID_ROWS, SITE_BBOX } from './constants';
import type { ShapeFamily } from './feature-kinds';
import { imageFractionToLonLat } from './legacy-image';

/** An area's outline: GeoJSON (RFC 7946), WGS84, positions as [lon, lat]. */
export type AreaGeometry = Polygon | MultiPolygon;

/** A map feature's geometry (see feature-kinds.ts for which kind uses which). */
export type FeatureGeometry = Point | LineString | MultiLineString | Polygon | MultiPolygon;

export class InvalidGeometryError extends Error {
  constructor(message: string) { super(message); this.name = 'InvalidGeometryError'; }
}

const MAX_POSITIONS = 5000;

/** ~1 cm. Keeps stored GeoJSON small without losing anything a map can show. */
function round(n: number): number {
  return Math.round(n * 1e7) / 1e7;
}

function parsePosition(p: unknown, count: { n: number }): Position {
  if (!Array.isArray(p) || p.length < 2 || !p.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    throw new InvalidGeometryError('A position must be [lon, lat] numbers.');
  }
  const [lon, lat] = p as number[];
  const [w, s, e, n] = SITE_BBOX;
  if (lon < w || lon > e || lat < s || lat > n) throw new InvalidGeometryError('The shape is outside the Alversjö area (check lon/lat order).');
  if (++count.n > MAX_POSITIONS) throw new InvalidGeometryError('The shape has too many points.');
  return [round(lon), round(lat)];
}

function parseLine(line: unknown, count: { n: number }): Position[] {
  if (!Array.isArray(line) || line.length < 2) throw new InvalidGeometryError('A line needs at least 2 positions.');
  return line.map((p) => parsePosition(p, count));
}

function parseRing(ring: unknown, count: { n: number }): Position[] {
  if (!Array.isArray(ring) || ring.length < 4) throw new InvalidGeometryError('A ring needs at least 4 positions.');
  const out = ring.map((p) => parsePosition(p, count));
  const [first, last] = [out[0], out[out.length - 1]];
  if (first[0] !== last[0] || first[1] !== last[1]) throw new InvalidGeometryError('A ring must end where it starts.');
  return out;
}

function parsePolygonRings(rings: unknown, count: { n: number }): Position[][] {
  if (!Array.isArray(rings) || rings.length === 0) throw new InvalidGeometryError('A polygon needs at least one ring.');
  return rings.map((r) => parseRing(r, count));
}

/** Validates untrusted input (e.g. from the editor) as an area outline, rounding positions to ~1 cm. */
export function parseAreaGeometry(input: unknown): AreaGeometry {
  if (!input || typeof input !== 'object') throw new InvalidGeometryError('Not a geometry.');
  const { type, coordinates } = input as { type?: unknown; coordinates?: unknown };
  const count = { n: 0 };
  if (type === 'Polygon') return { type, coordinates: parsePolygonRings(coordinates, count) };
  if (type === 'MultiPolygon') {
    if (!Array.isArray(coordinates) || coordinates.length === 0) throw new InvalidGeometryError('A multipolygon needs at least one polygon.');
    return { type, coordinates: coordinates.map((p) => parsePolygonRings(p, count)) };
  }
  throw new InvalidGeometryError('Only Polygon and MultiPolygon are supported.');
}

/** Validates untrusted input as a map feature geometry of the given shape family, rounding to ~1 cm. */
export function parseFeatureGeometry(input: unknown, shape: ShapeFamily): FeatureGeometry {
  if (shape === 'polygon') return parseAreaGeometry(input);
  if (!input || typeof input !== 'object') throw new InvalidGeometryError('Not a geometry.');
  const { type, coordinates } = input as { type?: unknown; coordinates?: unknown };
  const count = { n: 0 };
  if (shape === 'point') {
    if (type !== 'Point') throw new InvalidGeometryError('Expected a point.');
    return { type, coordinates: parsePosition(coordinates, count) };
  }
  if (type === 'LineString') return { type, coordinates: parseLine(coordinates, count) };
  if (type === 'MultiLineString') {
    if (!Array.isArray(coordinates) || coordinates.length === 0) throw new InvalidGeometryError('A multiline needs at least one line.');
    return { type, coordinates: coordinates.map((l) => parseLine(l, count)) };
  }
  throw new InvalidGeometryError('Expected a line.');
}

/** Combines several lines into one geometry: a LineString if there is one, else a MultiLineString. */
export function combineLines(lines: Position[][]): LineString | MultiLineString {
  return lines.length === 1 ? { type: 'LineString', coordinates: lines[0] } : { type: 'MultiLineString', coordinates: lines };
}

/** Combines several polygons into one geometry: a Polygon if there is one, else a MultiPolygon. */
export function combinePolygons(polygons: Position[][][]): AreaGeometry {
  return polygons.length === 1 ? { type: 'Polygon', coordinates: polygons[0] } : { type: 'MultiPolygon', coordinates: polygons };
}

/** Splits a geometry into its polygons (each a list of rings). */
export function splitPolygons(geometry: AreaGeometry): Position[][][] {
  return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
}

/**
 * Converts grid cells drawn on the old map image into a real-world outline: each cell becomes
 * a small quadrilateral in lon/lat, and touching cells are merged into one polygon.
 */
export function cellsToGeometry(cells: Array<{ col: number; row: number }>): AreaGeometry | null {
  if (cells.length === 0) return null;
  // Merge in whole grid units, where shared edges and straight lines are exact, then convert.
  const squares = cells.map(({ col, row }) => polygon([[[col, row], [col + 1, row], [col + 1, row + 1], [col, row + 1], [col, row]]]));
  const merged = squares.length === 1 ? squares[0] : union(featureCollection(squares));
  if (!merged) return null;
  // Union keeps the corners of every cell, including those in the middle of a straight edge.
  const toLonLat = ([col, row]: Position): Position => imageFractionToLonLat(col / GRID_COLS, row / GRID_ROWS);
  const polygons = splitPolygons(cleanCoords(merged).geometry).map((rings) => rings.map((ring) => ring.map(toLonLat)));
  return parseAreaGeometry(combinePolygons(polygons));
}

/** A point guaranteed to lie on the shape, for its label. Returned as Leaflet `[lat, lng]`. */
export function labelPoint(geometry: AreaGeometry): [number, number] {
  const [lon, lat] = pointOnFeature(geometry).geometry.coordinates;
  return [lat, lon];
}
