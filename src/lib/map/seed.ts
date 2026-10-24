import { schema, type Db } from '@/db';
import { listAreaCells, replaceAreaCells } from './area-cells';
import { GRID_COLS, GRID_ROWS } from './constants';
import { cellsInPolygon } from './polygon';
import { SEED_AREAS } from './seed-data';

export async function seedMapAreas(db: Db): Promise<void> {
  for (const entry of SEED_AREAS) {
    await db.insert(schema.area)
      .values({ id: entry.id, name: entry.name, description: '', capacity: null, bookable: true })
      .onConflictDoNothing();
    const existingCells = await listAreaCells(db, entry.id);
    if (existingCells.length === 0) {
      await replaceAreaCells(db, entry.id, cellsInPolygon(entry.polygon, GRID_COLS, GRID_ROWS));
    }
  }
}
