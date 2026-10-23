import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@/db';
import { AreaNotFoundError, createArea, listAreas, updateArea } from './service';

describe('area service', () => {
  let db: Db;
  beforeEach(async () => { db = await createDb('pglite://memory'); });

  it('lists areas ordered by name', async () => {
    await createArea(db, { name: 'Kitchen', description: '', capacity: 20, bookable: true });
    await createArea(db, { name: 'Big top', description: 'Main tent', capacity: null, bookable: true });
    const areas = await listAreas(db);
    expect(areas.map((a) => a.name)).toEqual(['Big top', 'Kitchen']);
  });

  it('updates an existing area', async () => {
    const created = await createArea(db, { name: 'Kitchen', description: '', capacity: 20, bookable: true });
    const updated = await updateArea(db, { id: created.id, name: 'Kitchen', description: 'Renovated', capacity: 25, bookable: true });
    expect(updated).toMatchObject({ description: 'Renovated', capacity: 25 });
  });

  it('throws for an unknown id', async () => {
    await expect(updateArea(db, { id: 'nope', name: 'X', description: '', capacity: null, bookable: true })).rejects.toBeInstanceOf(AreaNotFoundError);
  });
});
