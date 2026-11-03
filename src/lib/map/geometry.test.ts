import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { describe, expect, it } from 'vitest';
import { combinePolygons, hectares, InvalidGeometryError, labelPoint, parseAreaGeometry, splitPolygons } from './geometry';

const square = [[14.925, 57.621], [14.926, 57.621], [14.926, 57.622], [14.925, 57.622], [14.925, 57.621]];

describe('parseAreaGeometry', () => {
  it('accepts a Polygon and rounds positions to 7 decimals', () => {
    const g = parseAreaGeometry({ type: 'Polygon', coordinates: [[[14.925000001, 57.621], ...square.slice(1, 4), [14.925000001, 57.621]]] });
    expect(g).toEqual({ type: 'Polygon', coordinates: [square] });
  });

  it('accepts a MultiPolygon', () => {
    expect(parseAreaGeometry({ type: 'MultiPolygon', coordinates: [[square], [square]] }).type).toBe('MultiPolygon');
  });

  it.each([
    ['a non-object', 'nope'],
    ['an unsupported type', { type: 'Point', coordinates: [14.92, 57.62] }],
    ['an open ring', { type: 'Polygon', coordinates: [square.slice(0, 4)] }],
    ['too few positions', { type: 'Polygon', coordinates: [[square[0], square[1], square[0]]] }],
    ['a non-numeric position', { type: 'Polygon', coordinates: [[square[0], ['a', 'b'], square[2], square[0]]] }],
    ['lat/lon swapped (outside the site)', { type: 'Polygon', coordinates: [square.map(([lon, lat]) => [lat, lon])] }],
    ['an empty polygon', { type: 'Polygon', coordinates: [] }],
  ])('rejects %s', (_name, input) => {
    expect(() => parseAreaGeometry(input)).toThrow(InvalidGeometryError);
  });
});

describe('combinePolygons / splitPolygons', () => {
  it('round-trips one polygon as a Polygon and several as a MultiPolygon', () => {
    expect(combinePolygons([[square]])).toEqual({ type: 'Polygon', coordinates: [square] });
    const multi = combinePolygons([[square], [square]]);
    expect(multi.type).toBe('MultiPolygon');
    expect(splitPolygons(multi)).toHaveLength(2);
  });
});

describe('labelPoint', () => {
  it('returns a [lat, lng] inside the shape', () => {
    const g = parseAreaGeometry({ type: 'Polygon', coordinates: [square] });
    const [lat, lng] = labelPoint(g);
    expect(booleanPointInPolygon([lng, lat], g)).toBe(true);
  });
});

describe('hectares', () => {
  it('measures a 100 m square as one hectare', () => {
    // 100 m north-south is 0.000899° of latitude; 100 m east-west at 57.62° is 0.001678° of longitude.
    const [lon, lat] = [14.92, 57.62];
    const ring = [[lon, lat], [lon + 0.0016777, lat], [lon + 0.0016777, lat + 0.00089932], [lon, lat + 0.00089932], [lon, lat]];
    expect(hectares({ type: 'Polygon', coordinates: [ring] })).toBeCloseTo(1, 2);
  });
});
