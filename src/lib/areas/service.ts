import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { Area } from '@/db/schema';

export class AreaNotFoundError extends Error {
  constructor(id: string) { super(`No area ${id}`); this.name = 'AreaNotFoundError'; }
}

export type AreaInput = { name: string; description: string; capacity: number | null; bookable: boolean };

export function listAreas(db: Db): Promise<Area[]> {
  return db.select().from(schema.area).orderBy(schema.area.name);
}

export async function getArea(db: Db, id: string): Promise<Area | null> {
  const [row] = await db.select().from(schema.area).where(eq(schema.area.id, id));
  return row ?? null;
}

export async function createArea(db: Db, input: AreaInput): Promise<Area> {
  const [row] = await db.insert(schema.area).values({ id: randomUUID(), ...input }).returning();
  return row;
}

export async function updateArea(db: Db, input: AreaInput & { id: string }): Promise<Area> {
  const { id, ...fields } = input;
  const [row] = await db.update(schema.area).set(fields).where(eq(schema.area.id, id)).returning();
  if (!row) throw new AreaNotFoundError(id);
  return row;
}
