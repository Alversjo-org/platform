import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@/db';
import { getArea } from '@/lib/areas/service';
import { setAreaGeometry } from './area-geometry';
import { parseAreaGeometry } from './geometry';
import { SEED_AREAS } from './seed-data';
import { seedMapAreas } from './seed';

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

  it('leaves an existing seed area that was taken off the map off the map', async () => {
    await seedMapAreas(db);
    await setAreaGeometry(db, SEED_AREAS[0].id, null);
    await seedMapAreas(db);
    expect((await getArea(db, SEED_AREAS[0].id))?.geometry).toBeNull();
  });
});
