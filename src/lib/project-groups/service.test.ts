import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import {
  createProjectGroup, CostCentreAlreadyMappedError, findOrCreateProjectGroupByName, listProjectGroups,
  ProjectGroupNotFoundError, UnknownCostCentreError, updateProjectGroup,
} from './service';

describe('project-groups service', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.fxCostCentre).values([
      { id: 'cc1', code: 'INFRA', name: 'Infrastructure', active: true },
      { id: 'cc2', code: 'KOK', name: 'Kök', active: true },
    ]);
  });

  it('lists groups ordered by name', async () => {
    await createProjectGroup(db, { name: 'Kitchen', costCentreCode: null, parentId: null });
    await createProjectGroup(db, { name: 'Infrastructure', costCentreCode: null, parentId: null });
    expect((await listProjectGroups(db)).map((g) => g.name)).toEqual(['Infrastructure', 'Kitchen']);
  });

  it('creates and updates a group, including its cost-centre mapping', async () => {
    const created = await createProjectGroup(db, { name: 'Infrastructure', costCentreCode: 'INFRA', parentId: null });
    const updated = await updateProjectGroup(db, { id: created.id, name: 'Infra', costCentreCode: 'INFRA', parentId: null });
    expect(updated).toMatchObject({ name: 'Infra', costCentreCode: 'INFRA' });
  });

  it('rejects mapping a cost centre already mapped to another group', async () => {
    await createProjectGroup(db, { name: 'Infrastructure', costCentreCode: 'INFRA', parentId: null });
    await expect(createProjectGroup(db, { name: 'Kitchen', costCentreCode: 'INFRA', parentId: null }))
      .rejects.toBeInstanceOf(CostCentreAlreadyMappedError);
  });

  it('rejects remapping an existing group to a cost centre already mapped to another group', async () => {
    await createProjectGroup(db, { name: 'Infrastructure', costCentreCode: 'INFRA', parentId: null });
    const kitchen = await createProjectGroup(db, { name: 'Kitchen', costCentreCode: 'KOK', parentId: null });
    await expect(updateProjectGroup(db, { id: kitchen.id, name: 'Kitchen', costCentreCode: 'INFRA', parentId: null }))
      .rejects.toBeInstanceOf(CostCentreAlreadyMappedError);
  });

  it('rejects a cost centre code that does not exist, with a clear error instead of a raw FK violation', async () => {
    await expect(createProjectGroup(db, { name: 'Infrastructure', costCentreCode: 'NOPE', parentId: null }))
      .rejects.toBeInstanceOf(UnknownCostCentreError);
  });

  it('rejects remapping to a cost centre code that does not exist', async () => {
    const group = await createProjectGroup(db, { name: 'Infrastructure', costCentreCode: null, parentId: null });
    await expect(updateProjectGroup(db, { id: group.id, name: 'Infrastructure', costCentreCode: 'NOPE', parentId: null }))
      .rejects.toBeInstanceOf(UnknownCostCentreError);
  });

  it('throws for an unknown id on update', async () => {
    await expect(updateProjectGroup(db, { id: 'nope', name: 'X', costCentreCode: null, parentId: null }))
      .rejects.toBeInstanceOf(ProjectGroupNotFoundError);
  });

  it('findOrCreateProjectGroupByName reuses an existing group case-insensitively, else creates one', async () => {
    const created = await createProjectGroup(db, { name: 'Operating Costs', costCentreCode: null, parentId: null });
    const found = await findOrCreateProjectGroupByName(db, 'operating costs');
    expect(found.id).toBe(created.id);
    const fresh = await findOrCreateProjectGroupByName(db, 'Land Investment');
    expect(fresh.name).toBe('Land Investment');
    expect((await listProjectGroups(db)).map((g) => g.name).sort()).toEqual(['Land Investment', 'Operating Costs']);
  });
});
