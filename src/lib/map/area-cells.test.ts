import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import { listAreaCells, listAreasWithCells, replaceAreaCells } from './area-cells';

describe('area-cells', () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.area).values([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  });

  it('replaceAreaCells fully overwrites a prior set', async () => {
    await replaceAreaCells(db, 'a', [{ col: 0, row: 0 }, { col: 1, row: 0 }]);
    await replaceAreaCells(db, 'a', [{ col: 2, row: 2 }]);
    expect(await listAreaCells(db, 'a')).toEqual([{ col: 2, row: 2 }]);
  });

  it('a cell can belong to two different areas at once', async () => {
    await replaceAreaCells(db, 'a', [{ col: 5, row: 5 }]);
    await replaceAreaCells(db, 'b', [{ col: 5, row: 5 }]);
    expect(await listAreaCells(db, 'a')).toEqual([{ col: 5, row: 5 }]);
    expect(await listAreaCells(db, 'b')).toEqual([{ col: 5, row: 5 }]);
  });

  it('deleting an area cascades to remove its cells', async () => {
    await replaceAreaCells(db, 'a', [{ col: 0, row: 0 }]);
    await db.delete(schema.area).where(eq(schema.area.id, 'a'));
    expect(await listAreaCells(db, 'a')).toEqual([]);
  });

  it('listAreasWithCells returns every area, pairing empty-celled ones with []', async () => {
    await replaceAreaCells(db, 'a', [{ col: 0, row: 0 }]);
    const result = await listAreasWithCells(db);
    expect(result.find((r) => r.area.id === 'a')?.cells).toEqual([{ col: 0, row: 0 }]);
    expect(result.find((r) => r.area.id === 'b')?.cells).toEqual([]);
  });
});
