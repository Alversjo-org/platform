import { and, eq, isNull } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import { cellsToGeometry, parseAreaGeometry } from './geometry';
import { SEED_AREAS } from './seed-data';

/**
 * Runs on every deploy (fly.toml release_command), so it must be idempotent and never
 * overwrite an outline someone drew.
 *
 * 1. Creates any of the eleven seed sections that don't exist yet, with their starting outline.
 * 2. Gives every area that still has no outline one converted from its old grid cells, if it
 *    has any. This is the one-time move from image grid cells to real coordinates; once an
 *    area has an outline its cells are ignored.
 */
export async function seedMapAreas(db: Db): Promise<void> {
  for (const entry of SEED_AREAS) {
    const geometry = parseAreaGeometry({ type: 'Polygon', coordinates: [[...entry.ring, entry.ring[0]]] });
    await db.insert(schema.area)
      .values({ id: entry.id, name: entry.name, description: '', capacity: null, bookable: true, geometry })
      .onConflictDoNothing();
  }
  await backfillGeometryFromCells(db);
}

export async function backfillGeometryFromCells(db: Db): Promise<void> {
  const rows = await db.select({ areaId: schema.areaGridCell.areaId, col: schema.areaGridCell.col, row: schema.areaGridCell.row })
    .from(schema.areaGridCell)
    .innerJoin(schema.area, eq(schema.area.id, schema.areaGridCell.areaId))
    .where(isNull(schema.area.geometry));
  const cellsByArea = new Map<string, Array<{ col: number; row: number }>>();
  for (const { areaId, col, row } of rows) {
    cellsByArea.set(areaId, [...(cellsByArea.get(areaId) ?? []), { col, row }]);
  }
  for (const [areaId, cells] of cellsByArea) {
    const geometry = cellsToGeometry(cells);
    if (!geometry) continue;
    // Re-checks isNull so a concurrent edit in the editor is never overwritten.
    await db.update(schema.area).set({ geometry }).where(and(eq(schema.area.id, areaId), isNull(schema.area.geometry)));
  }
}
