import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import { FEATURE_KINDS, isFeatureKind } from './feature-kinds';
import { createMapFeature, deleteMapFeature, getMapFeature, listMapFeatures, MapFeatureNotFoundError, updateMapFeature } from './features';
import { InvalidGeometryError } from './geometry';

const point = (lon: number, lat: number) => ({ type: 'Point' as const, coordinates: [lon, lat] });

describe('initial map features (migration 0013)', () => {
  let db: Db;
  beforeEach(async () => { db = await createDb('pglite://memory'); });

  it('are in the database, all of known kinds with geometry of the right shape', async () => {
    const rows = await listMapFeatures(db);
    expect(rows.length).toBe(171);
    for (const r of rows) {
      expect(isFeatureKind(r.kind)).toBe(true);
      const shape = FEATURE_KINDS[r.kind].shape;
      const types = { point: ['Point'], line: ['LineString', 'MultiLineString'], polygon: ['Polygon', 'MultiPolygon'] }[shape];
      expect(types).toContain(r.geometry.type);
    }
  });

  it('include the agreed places and leave out Borderland-only ones', async () => {
    const names = (await listMapFeatures(db)).map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['The Well', 'Water tap', 'Downtown Toilets', 'The Barn', 'Machine Hall', 'The Brewery', 'Sheep barn']));
    for (const banned of ['Main parking', 'Threshold Check-in "Gate"', 'The Sanctuary', 'Gate Toilets']) expect(names).not.toContain(banned);
  });
});

describe('map feature editing', () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.delete(schema.mapFeature);
    await db.insert(schema.user).values({ id: 'u1', email: 'mapper@example.org' });
  });

  it('creates, updates (incl. kind within the same shape family) and deletes a point', async () => {
    const created = await createMapFeature(db, { kind: 'toilet', name: ' New toilet ', description: '', geometry: point(14.9266, 57.6212) }, 'u1');
    expect(created).toMatchObject({ kind: 'toilet', name: 'New toilet', updatedByUserId: 'u1' });

    const moved = await updateMapFeature(db, created.id, { kind: 'water', name: 'Tap', description: 'Summer only', geometry: point(14.927, 57.6213) }, 'u1');
    expect(moved).toMatchObject({ kind: 'water', name: 'Tap', description: 'Summer only', geometry: point(14.927, 57.6213) });

    await deleteMapFeature(db, created.id);
    expect(await getMapFeature(db, created.id)).toBeNull();
  });

  it('rejects geometry that does not fit the kind (a line for a toilet, a point for a path)', async () => {
    const line = { type: 'LineString', coordinates: [[14.926, 57.621], [14.927, 57.622]] };
    await expect(createMapFeature(db, { kind: 'toilet', name: '', description: '', geometry: line }, 'u1')).rejects.toThrow(InvalidGeometryError);
    await expect(createMapFeature(db, { kind: 'path', name: '', description: '', geometry: point(14.92, 57.62) }, 'u1')).rejects.toThrow(InvalidGeometryError);
    expect(await createMapFeature(db, { kind: 'path', name: '', description: '', geometry: line }, 'u1')).toMatchObject({ kind: 'path' });
  });

  it('rejects unknown kinds and points outside the site', async () => {
    await expect(createMapFeature(db, { kind: 'bar' as never, name: '', description: '', geometry: point(14.92, 57.62) }, 'u1')).rejects.toThrow(InvalidGeometryError);
    await expect(createMapFeature(db, { kind: 'toilet', name: '', description: '', geometry: point(57.62, 14.92) }, 'u1')).rejects.toThrow(InvalidGeometryError);
  });

  it('throws for unknown ids', async () => {
    await expect(updateMapFeature(db, 'nope', { kind: 'toilet', name: '', description: '', geometry: point(14.92, 57.62) }, 'u1')).rejects.toThrow(MapFeatureNotFoundError);
    await expect(deleteMapFeature(db, 'nope')).rejects.toThrow(MapFeatureNotFoundError);
  });
});
