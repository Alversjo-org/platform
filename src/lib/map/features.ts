import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { MapFeature } from '@/db/schema';
import { FEATURE_KINDS, isFeatureKind, type FeatureKind } from './feature-kinds';
import { InvalidGeometryError, parseFeatureGeometry } from './geometry';

export class MapFeatureNotFoundError extends Error {
  constructor(id: string) { super(`No map feature ${id}`); this.name = 'MapFeatureNotFoundError'; }
}

export type MapFeatureInput = { kind: FeatureKind; name: string; description: string; geometry: unknown };

/** Validates editor input. The geometry must match the kind's shape family (point/line/polygon). */
export function parseMapFeatureInput(input: { kind: unknown; name: unknown; description: unknown; geometry: unknown }) {
  if (!isFeatureKind(input.kind)) throw new InvalidGeometryError('Unknown kind.');
  const name = String(input.name ?? '').trim();
  if (name.length > 200) throw new InvalidGeometryError('The name is too long.');
  return {
    kind: input.kind,
    name,
    description: String(input.description ?? '').trim().slice(0, 2000),
    geometry: parseFeatureGeometry(input.geometry, FEATURE_KINDS[input.kind].shape),
  };
}

export function listMapFeatures(db: Db): Promise<MapFeature[]> {
  return db.select().from(schema.mapFeature).orderBy(asc(schema.mapFeature.kind), asc(schema.mapFeature.name));
}

export async function getMapFeature(db: Db, id: string): Promise<MapFeature | null> {
  const [row] = await db.select().from(schema.mapFeature).where(eq(schema.mapFeature.id, id));
  return row ?? null;
}

export async function createMapFeature(db: Db, input: MapFeatureInput, userId: string): Promise<MapFeature> {
  const fields = parseMapFeatureInput(input);
  const [row] = await db.insert(schema.mapFeature)
    .values({ id: randomUUID(), ...fields, updatedByUserId: userId })
    .returning();
  return row;
}

/** Changing the kind is only allowed within the same shape family; parseMapFeatureInput enforces it. */
export async function updateMapFeature(db: Db, id: string, input: MapFeatureInput, userId: string): Promise<MapFeature> {
  const fields = parseMapFeatureInput(input);
  const [row] = await db.update(schema.mapFeature)
    .set({ ...fields, updatedAt: new Date(), updatedByUserId: userId })
    .where(eq(schema.mapFeature.id, id))
    .returning();
  if (!row) throw new MapFeatureNotFoundError(id);
  return row;
}

export async function deleteMapFeature(db: Db, id: string): Promise<void> {
  const rows = await db.delete(schema.mapFeature).where(eq(schema.mapFeature.id, id)).returning({ id: schema.mapFeature.id });
  if (rows.length === 0) throw new MapFeatureNotFoundError(id);
}

/** What the map components need: plain JSON, no dates. */
export type MapFeatureData = Pick<MapFeature, 'id' | 'kind' | 'name' | 'description' | 'geometry' | 'properties'>;

export function toMapFeatureData(rows: MapFeature[]): MapFeatureData[] {
  return rows
    .filter((r) => isFeatureKind(r.kind)) // a kind removed from code shouldn't break the map
    .map(({ id, kind, name, description, geometry, properties }) => ({ id, kind, name, description, geometry, properties }));
}
