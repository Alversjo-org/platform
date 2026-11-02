'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db';
import { createMapFeature, deleteMapFeature, MapFeatureNotFoundError, updateMapFeature } from '@/lib/map/features';
import type { FeatureKind } from '@/lib/map/feature-kinds';
import { InvalidGeometryError } from '@/lib/map/geometry';
import { requireMapper } from '@/lib/session';

type Result = { ok: true; id: string } | { error: string };

/** Creates (id null) or updates a map feature from the editor. */
export async function saveMapFeatureAction(
  id: string | null,
  input: { kind: string; name: string; description: string; geometry: unknown },
): Promise<Result> {
  const user = await requireMapper();
  if (input.geometry === null) return { error: 'Place it on the map first.' };
  const db = await getDb();
  const fields = { ...input, kind: input.kind as FeatureKind };
  try {
    const row = id ? await updateMapFeature(db, id, fields, user.id) : await createMapFeature(db, fields, user.id);
    revalidatePath('/map');
    revalidatePath('/map/features');
    return { ok: true, id: row.id };
  } catch (e) {
    if (e instanceof InvalidGeometryError) return { error: e.message };
    if (e instanceof MapFeatureNotFoundError) return { error: 'This feature no longer exists.' };
    throw e;
  }
}

export async function deleteMapFeatureAction(id: string): Promise<Result> {
  await requireMapper();
  try {
    await deleteMapFeature(await getDb(), id);
  } catch (e) {
    if (!(e instanceof MapFeatureNotFoundError)) throw e;
  }
  revalidatePath('/map');
  revalidatePath('/map/features');
  return { ok: true, id };
}
