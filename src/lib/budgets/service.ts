import { randomUUID } from 'node:crypto';
import { and, desc, eq, ne } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { AnnualBudget, BudgetAmount, BudgetLineKind } from '@/db/schema';
import { logDecision } from '@/lib/decision-log';

export class BudgetVersionNotEditableError extends Error {
  constructor(id: string) { super(`Budget version ${id} is not the current draft`); this.name = 'BudgetVersionNotEditableError'; }
}

export type BudgetAmountInput = {
  id?: string;
  annualBudgetId: string;
  description: string;
  projectGroupId: string | null;
  projectId: string | null;
  kind: BudgetLineKind;
  month: number | null;
  amountSek: number;
  accountFrom: number | null;
  accountTo: number | null;
};

async function getAnnualBudget(db: Db, id: string): Promise<AnnualBudget | null> {
  const [row] = await db.select().from(schema.annualBudget).where(eq(schema.annualBudget.id, id));
  return row ?? null;
}

async function requireDraft(db: Db, annualBudgetId: string): Promise<AnnualBudget> {
  const budget = await getAnnualBudget(db, annualBudgetId);
  if (!budget || budget.status !== 'draft') throw new BudgetVersionNotEditableError(annualBudgetId);
  return budget;
}

export async function getOrCreateDraft(db: Db, fiscalYear: number): Promise<AnnualBudget> {
  const [latest] = await db.select().from(schema.annualBudget)
    .where(eq(schema.annualBudget.fiscalYear, fiscalYear))
    .orderBy(desc(schema.annualBudget.version))
    .limit(1);

  if (latest?.status === 'draft') return latest;

  const nextVersion = latest ? latest.version + 1 : 1;
  const [draft] = await db.insert(schema.annualBudget).values({
    id: randomUUID(), fiscalYear, version: nextVersion, status: 'draft',
  }).returning();

  if (latest) {
    const priorLines = await listBudgetAmounts(db, latest.id);
    if (priorLines.length > 0) {
      await db.insert(schema.budgetAmount).values(priorLines.map((line) => ({
        id: randomUUID(),
        annualBudgetId: draft.id,
        description: line.description,
        projectGroupId: line.projectGroupId,
        projectId: line.projectId,
        kind: line.kind,
        month: line.month,
        amountSek: line.amountSek,
        accountFrom: line.accountFrom,
        accountTo: line.accountTo,
      })));
    }
  }

  return draft;
}

export function listVersions(db: Db, fiscalYear: number): Promise<AnnualBudget[]> {
  return db.select().from(schema.annualBudget).where(eq(schema.annualBudget.fiscalYear, fiscalYear)).orderBy(desc(schema.annualBudget.version));
}

export function listBudgetAmounts(db: Db, annualBudgetId: string): Promise<BudgetAmount[]> {
  return db.select().from(schema.budgetAmount).where(eq(schema.budgetAmount.annualBudgetId, annualBudgetId));
}

export async function upsertBudgetAmount(db: Db, input: BudgetAmountInput): Promise<BudgetAmount> {
  await requireDraft(db, input.annualBudgetId);
  const fields = {
    annualBudgetId: input.annualBudgetId,
    description: input.description,
    projectGroupId: input.projectGroupId,
    projectId: input.projectId,
    kind: input.kind,
    month: input.month,
    amountSek: input.amountSek,
    accountFrom: input.accountFrom,
    accountTo: input.accountTo,
  };

  if (input.id) {
    const [row] = await db.update(schema.budgetAmount).set(fields).where(eq(schema.budgetAmount.id, input.id)).returning();
    return row;
  }
  const [row] = await db.insert(schema.budgetAmount).values({ id: randomUUID(), ...fields }).returning();
  return row;
}

export async function deleteBudgetAmount(db: Db, id: string): Promise<void> {
  const [line] = await db.select().from(schema.budgetAmount).where(eq(schema.budgetAmount.id, id));
  if (line) await requireDraft(db, line.annualBudgetId);
  await db.delete(schema.budgetAmount).where(eq(schema.budgetAmount.id, id));
}

export async function approveBudget(db: Db, input: { annualBudgetId: string; actorUserId: string }): Promise<AnnualBudget> {
  return db.transaction(async (tx) => {
    const draft = await getAnnualBudget(tx, input.annualBudgetId);
    if (!draft || draft.status !== 'draft') throw new BudgetVersionNotEditableError(input.annualBudgetId);

    const [approved] = await tx.update(schema.annualBudget)
      .set({ status: 'approved', approvedByUserId: input.actorUserId, approvedAt: new Date() })
      .where(eq(schema.annualBudget.id, draft.id))
      .returning();

    // Supersede whichever version was previously approved for this fiscal year — excluding the
    // one just approved above, which now also has status 'approved' and must not match itself.
    await tx.update(schema.annualBudget)
      .set({ status: 'superseded' })
      .where(and(
        eq(schema.annualBudget.fiscalYear, draft.fiscalYear),
        eq(schema.annualBudget.status, 'approved'),
        ne(schema.annualBudget.id, draft.id),
      ));

    await logDecision(tx, {
      entity: 'annual_budget', entityId: draft.id, actorUserId: input.actorUserId,
      action: 'approved', diff: { fiscalYear: draft.fiscalYear, version: draft.version },
    });

    return approved;
  });
}

export function computeBudgetTotals(lines: BudgetAmount[]): { totalCostSek: number; totalIncomeSek: number; totalAllocationSek: number; resultSek: number } {
  let totalCostSek = 0;
  let totalIncomeSek = 0;
  let totalAllocationSek = 0;
  for (const line of lines) {
    if (line.kind === 'cost') totalCostSek += line.amountSek;
    else if (line.kind === 'income') totalIncomeSek += line.amountSek;
    else totalAllocationSek += line.amountSek;
  }
  return { totalCostSek, totalIncomeSek, totalAllocationSek, resultSek: totalIncomeSek - totalCostSek };
}
