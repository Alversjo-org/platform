import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@/db';
import { listAreaCells } from './area-cells';
import { replaceAreaCells } from './area-cells';
import { SEED_AREAS } from './seed-data';
import { seedMapAreas } from './seed';

describe('seedMapAreas', () => {
  let db: Db;
  beforeEach(async () => { db = await createDb('pglite://memory'); });

  it('creates all eleven areas, each with at least one cell', async () => {
    await seedMapAreas(db);
    for (const entry of SEED_AREAS) {
      expect(await listAreaCells(db, entry.id)).not.toEqual([]);
    }
  });

  it('is idempotent: re-running does not duplicate areas or clobber cells someone else already changed', async () => {
    await seedMapAreas(db);
    const customCells = [{ col: 0, row: 0 }];
    await replaceAreaCells(db, SEED_AREAS[0].id, customCells);
    await seedMapAreas(db);
    expect(await listAreaCells(db, SEED_AREAS[0].id)).toEqual(customCells);
  });
});
