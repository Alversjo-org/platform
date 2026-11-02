import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import type { Area } from '@/db/schema';
import { AreaNotFoundError } from '@/lib/areas/service';
import { listMappedAreas, setAreaGeometry } from './area-geometry';
import { areasToFeatureCollection } from './geojson';

const geometry = { type: 'Polygon' as const, coordinates: [[[14.925, 57.621], [14.926, 57.621], [14.926, 57.622], [14.925, 57.621]]] };

describe('areasToFeatureCollection', () => {
  it('emits one Feature per mapped area with [lon, lat] geometry and plain properties', () => {
    const areas = [
      { id: 'f', name: 'Field', description: 'Grass', capacity: 40, bookable: true, geometry },
      { id: 'kitchen', name: 'Kitchen', description: '', capacity: null, bookable: true, geometry: null },
    ] as Area[];
    const fc = areasToFeatureCollection(areas);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]).toMatchObject({
      type: 'Feature', id: 'f', geometry,
      properties: { id: 'f', name: 'Field', description: 'Grass', capacity: 40, bookable: true },
    });
    expect(fc.features[0].properties.fill).toMatch(/^hsl\(/);
  });
});

describe('area geometry storage', () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.area).values([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  });

  it('stores and lists outlines; areas without one are not mapped', async () => {
    await setAreaGeometry(db, 'a', geometry);
    const mapped = await listMappedAreas(db);
    expect(mapped.map((a) => a.id)).toEqual(['a']);
    expect(mapped[0].geometry).toEqual(geometry);
  });

  it('null takes an area off the map', async () => {
    await setAreaGeometry(db, 'a', geometry);
    await setAreaGeometry(db, 'a', null);
    expect(await listMappedAreas(db)).toEqual([]);
  });

  it('throws for an unknown area', async () => {
    await expect(setAreaGeometry(db, 'nope', geometry)).rejects.toThrow(AreaNotFoundError);
  });
});
