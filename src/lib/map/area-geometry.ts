import { eq, isNotNull } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { Area } from '@/db/schema';
import { AreaNotFoundError } from '@/lib/areas/service';
import type { AreaGeometry } from './geometry';

/** Areas that have an outline, i.e. everything drawn on the map. */
export function listMappedAreas(db: Db): Promise<Area[]> {
  return db.select().from(schema.area).where(isNotNull(schema.area.geometry)).orderBy(schema.area.name);
}

/** Replaces an area's outline. `null` takes the area off the map (it stays bookable). */
export async function setAreaGeometry(db: Db, id: string, geometry: AreaGeometry | null): Promise<void> {
  const rows = await db.update(schema.area).set({ geometry }).where(eq(schema.area.id, id)).returning({ id: schema.area.id });
  if (rows.length === 0) throw new AreaNotFoundError(id);
}
