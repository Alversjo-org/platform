'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db';
import { setAreaGeometry } from '@/lib/map/area-geometry';
import { InvalidGeometryError, parseAreaGeometry } from '@/lib/map/geometry';
import { requireMapper } from '@/lib/session';

/** Saves an area's outline from the editor. `null` takes the area off the map. */
export async function saveAreaShapeAction(areaId: string, geometry: unknown): Promise<{ ok: true } | { error: string }> {
  await requireMapper();
  let parsed;
  try {
    parsed = geometry === null ? null : parseAreaGeometry(geometry);
  } catch (e) {
    if (e instanceof InvalidGeometryError) return { error: e.message };
    throw e;
  }
  await setAreaGeometry(await getDb(), areaId, parsed);
  revalidatePath('/map');
  revalidatePath(`/areas/${areaId}/shape`);
  return { ok: true };
}
