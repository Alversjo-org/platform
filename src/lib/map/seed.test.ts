import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import { getArea } from '@/lib/areas/service';
import { setAreaGeometry } from './area-geometry';
import { parseAreaGeometry } from './geometry';
import { SEED_AREAS } from './seed-data';
import { backfillGeometryFromCells, seedMapAreas } from './seed';

const drawn = parseAreaGeometry({ type: 'Polygon', coordinates: [[[14.925, 57.621], [14.926, 57.621], [14.926, 57.622], [14.925, 57.621]]] });

describe('seedMapAreas', () => {
  let db: Db;
  beforeEach(async () => { db = await createDb('pglite://memory'); });

  it('creates all eleven areas, each with an outline', async () => {
    await seedMapAreas(db);
    for (const entry of SEED_AREAS) {
      expect((await getArea(db, entry.id))?.geometry?.type).toBe('Polygon');
    }
  });

  it('is idempotent and never overwrites an outline someone drew', async () => {
    await seedMapAreas(db);
    await setAreaGeometry(db, SEED_AREAS[0].id, drawn);
    await seedMapAreas(db);
    expect((await getArea(db, SEED_AREAS[0].id))?.geometry).toEqual(drawn);
  });

  it('leaves an existing seed area that was taken off the map (and has no cells) off the map', async () => {
    await seedMapAreas(db);
    await setAreaGeometry(db, SEED_AREAS[0].id, null);
    await seedMapAreas(db);
    expect((await getArea(db, SEED_AREAS[0].id))?.geometry).toBeNull();
  });
});

describe('backfillGeometryFromCells', () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.area).values([
      { id: 'cells-only', name: 'Cells only' },
      { id: 'already-drawn', name: 'Already drawn', geometry: drawn },
      { id: 'kitchen', name: 'Kitchen' },
    ]);
    await db.insert(schema.areaGridCell).values([
      { areaId: 'cells-only', col: 30, row: 50 }, { areaId: 'cells-only', col: 31, row: 50 },
      { areaId: 'already-drawn', col: 1, row: 1 },
    ]);
  });

  it('gives an area with grid cells and no outline an outline converted from its cells', async () => {
    await backfillGeometryFromCells(db);
    expect((await getArea(db, 'cells-only'))?.geometry?.type).toBe('Polygon');
  });

  it('keeps an outline that already exists, and leaves areas without cells off the map', async () => {
    await backfillGeometryFromCells(db);
    expect((await getArea(db, 'already-drawn'))?.geometry).toEqual(drawn);
    expect((await getArea(db, 'kitchen'))?.geometry).toBeNull();
  });

  it('does not touch the cells themselves', async () => {
    await backfillGeometryFromCells(db);
    const cells = await db.select().from(schema.areaGridCell).where(eq(schema.areaGridCell.areaId, 'cells-only'));
    expect(cells).toHaveLength(2);
  });
});
