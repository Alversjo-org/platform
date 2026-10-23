import { eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { Area } from '@/db/schema';
import { listAreas } from '@/lib/areas/service';

export async function listAreaCells(db: Db, areaId: string): Promise<Array<{ col: number; row: number }>> {
  return db.select({ col: schema.areaGridCell.col, row: schema.areaGridCell.row })
    .from(schema.areaGridCell)
    .where(eq(schema.areaGridCell.areaId, areaId));
}

export async function replaceAreaCells(db: Db, areaId: string, cells: Array<{ col: number; row: number }>): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(schema.areaGridCell).where(eq(schema.areaGridCell.areaId, areaId));
    if (cells.length) {
      await tx.insert(schema.areaGridCell).values(cells.map((c) => ({ areaId, col: c.col, row: c.row })));
    }
  });
}

export async function listAreasWithCells(db: Db): Promise<Array<{ area: Area; cells: Array<{ col: number; row: number }> }>> {
  const [areas, cellRows] = await Promise.all([
    listAreas(db),
    db.select({ areaId: schema.areaGridCell.areaId, col: schema.areaGridCell.col, row: schema.areaGridCell.row }).from(schema.areaGridCell),
  ]);
  const cellsByAreaId = new Map<string, Array<{ col: number; row: number }>>();
  for (const { areaId, col, row } of cellRows) {
    const list = cellsByAreaId.get(areaId) ?? [];
    list.push({ col, row });
    cellsByAreaId.set(areaId, list);
  }
  return areas.map((area) => ({ area, cells: cellsByAreaId.get(area.id) ?? [] }));
}
