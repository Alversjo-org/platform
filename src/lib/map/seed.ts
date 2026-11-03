import { schema, type Db } from '@/db';
import { parseAreaGeometry } from './geometry';
import { SEED_AREAS } from './seed-data';

/**
 * Runs on every deploy (fly.toml release_command), so it must be idempotent and never
 * overwrite an outline someone drew.
 *
 * Creates any of the eleven seed sections that don't exist yet, with their starting outline.
 */
export async function seedMapAreas(db: Db): Promise<void> {
  for (const entry of SEED_AREAS) {
    const geometry = parseAreaGeometry({ type: 'Polygon', coordinates: [[...entry.ring, entry.ring[0]]] });
    await db.insert(schema.area)
      .values({ id: entry.id, name: entry.name, description: '', capacity: null, bookable: true, geometry })
      .onConflictDoNothing();
  }
}
