import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import type { BudgetAmount } from '@/db/schema';
import { createProjectGroup } from '@/lib/project-groups/service';
import {
  approveBudget, BudgetVersionNotEditableError, computeBudgetTotals, deleteBudgetAmount, getOrCreateDraft,
  listBudgetAmounts, listVersions, upsertBudgetAmount,
} from './service';

async function seedGroup(db: Db, name = 'Infrastructure') {
  return createProjectGroup(db, { name, costCentreCode: null, parentId: null });
}

describe('budgets service', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
  });

  it('creates version 1 as draft when no budget exists for the year', async () => {
    const draft = await getOrCreateDraft(db, 2027);
    expect(draft).toMatchObject({ fiscalYear: 2027, version: 1, status: 'draft' });
  });

  it('returns the existing draft on a second call instead of creating another', async () => {
    const first = await getOrCreateDraft(db, 2027);
    const second = await getOrCreateDraft(db, 2027);
    expect(second.id).toBe(first.id);
  });

  it('upsertBudgetAmount adds a line to the draft, with or without a group', async () => {
    const draft = await getOrCreateDraft(db, 2027);
    const group = await seedGroup(db);
    const grouped = await upsertBudgetAmount(db, { annualBudgetId: draft.id, description: 'Electricity', projectGroupId: group.id, projectId: null, kind: 'cost', month: null, amountSek: 12_000_00, accountFrom: null, accountTo: null });
    const ungrouped = await upsertBudgetAmount(db, { annualBudgetId: draft.id, description: 'Rainy Day Fund', projectGroupId: null, projectId: null, kind: 'allocation', month: null, amountSek: 9_300_84, accountFrom: null, accountTo: null });
    const lines = await listBudgetAmounts(db, draft.id);
    expect(lines).toMatchObject([{ id: grouped.id, description: 'Electricity' }, { id: ungrouped.id, description: 'Rainy Day Fund', projectGroupId: null }]);
  });

  it('upsertBudgetAmount updates an existing line when given an id', async () => {
    const draft = await getOrCreateDraft(db, 2027);
    const group = await seedGroup(db);
    const line = await upsertBudgetAmount(db, { annualBudgetId: draft.id, description: 'Electricity', projectGroupId: group.id, projectId: null, kind: 'cost', month: null, amountSek: 12_000_00, accountFrom: null, accountTo: null });
    const updated = await upsertBudgetAmount(db, { id: line.id, annualBudgetId: draft.id, description: 'Electricity', projectGroupId: group.id, projectId: null, kind: 'cost', month: null, amountSek: 15_000_00, accountFrom: null, accountTo: null });
    expect(updated.id).toBe(line.id);
    expect(await listBudgetAmounts(db, draft.id)).toMatchObject([{ id: line.id, amountSek: 15_000_00 }]);
  });

  it('deleteBudgetAmount removes a line from the draft', async () => {
    const draft = await getOrCreateDraft(db, 2027);
    const line = await upsertBudgetAmount(db, { annualBudgetId: draft.id, description: 'X', projectGroupId: null, projectId: null, kind: 'cost', month: null, amountSek: 1, accountFrom: null, accountTo: null });
    await deleteBudgetAmount(db, line.id);
    expect(await listBudgetAmounts(db, draft.id)).toEqual([]);
  });

  it('approveBudget freezes the draft and copying forward starts a new draft that supersedes it on its own approval', async () => {
    const group = await seedGroup(db);
    const v1 = await getOrCreateDraft(db, 2027);
    await upsertBudgetAmount(db, { annualBudgetId: v1.id, description: 'Electricity', projectGroupId: group.id, projectId: null, kind: 'cost', month: null, amountSek: 10_000_00, accountFrom: null, accountTo: null });
    await approveBudget(db, { annualBudgetId: v1.id, actorUserId: 'u1' });

    const v2 = await getOrCreateDraft(db, 2027); // revising: should copy v1's line forward
    expect(v2.id).not.toBe(v1.id);
    expect(v2).toMatchObject({ version: 2, status: 'draft' });
    expect(await listBudgetAmounts(db, v2.id)).toMatchObject([{ projectGroupId: group.id, amountSek: 10_000_00 }]);

    await approveBudget(db, { annualBudgetId: v2.id, actorUserId: 'u1' });
    const versions = await listVersions(db, 2027);
    expect(versions.find((v) => v.id === v1.id)?.status).toBe('superseded');
    expect(versions.find((v) => v.id === v2.id)?.status).toBe('approved');
  });

  it('rejects editing a version that is not the current draft', async () => {
    const group = await seedGroup(db);
    const v1 = await getOrCreateDraft(db, 2027);
    await approveBudget(db, { annualBudgetId: v1.id, actorUserId: 'u1' });
    await expect(upsertBudgetAmount(db, { annualBudgetId: v1.id, description: 'X', projectGroupId: group.id, projectId: null, kind: 'cost', month: null, amountSek: 1, accountFrom: null, accountTo: null }))
      .rejects.toBeInstanceOf(BudgetVersionNotEditableError);
  });

  it('rejects deleting a line from a version that is not the current draft', async () => {
    const v1 = await getOrCreateDraft(db, 2027);
    const line = await upsertBudgetAmount(db, { annualBudgetId: v1.id, description: 'X', projectGroupId: null, projectId: null, kind: 'cost', month: null, amountSek: 1, accountFrom: null, accountTo: null });
    await approveBudget(db, { annualBudgetId: v1.id, actorUserId: 'u1' });
    await expect(deleteBudgetAmount(db, line.id)).rejects.toBeInstanceOf(BudgetVersionNotEditableError);
  });
});

describe('computeBudgetTotals', () => {
  it('sums cost and income separately and excludes allocation lines from the result', () => {
    const totals = computeBudgetTotals([
      { kind: 'cost', amountSek: 1_000_00 } as BudgetAmount,
      { kind: 'cost', amountSek: 500_00 } as BudgetAmount,
      { kind: 'income', amountSek: 2_000_00 } as BudgetAmount,
      { kind: 'allocation', amountSek: 300_00 } as BudgetAmount,
    ]);
    expect(totals).toEqual({ totalCostSek: 1_500_00, totalIncomeSek: 2_000_00, totalAllocationSek: 300_00, resultSek: 500_00 });
  });
});
