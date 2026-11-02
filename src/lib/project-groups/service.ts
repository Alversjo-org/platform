import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { ProjectGroup } from '@/db/schema';

export class ProjectGroupNotFoundError extends Error {
  constructor(id: string) { super(`No project group ${id}`); this.name = 'ProjectGroupNotFoundError'; }
}

export class CostCentreAlreadyMappedError extends Error {
  constructor(costCentreCode: string) { super(`Cost centre ${costCentreCode} is already mapped to another group`); this.name = 'CostCentreAlreadyMappedError'; }
}

export class UnknownCostCentreError extends Error {
  constructor(costCentreCode: string) { super(`No Fortnox cost centre with code ${costCentreCode}`); this.name = 'UnknownCostCentreError'; }
}

export type ProjectGroupInput = { name: string; costCentreCode: string | null; parentId: string | null };

function pgErrorCode(error: unknown): string | undefined {
  const pgError = error as { code?: string; cause?: { code?: string } };
  return pgError.code ?? pgError.cause?.code;
}

function pgErrorConstraint(error: unknown): string | undefined {
  const pgError = error as { constraint?: string; cause?: { constraint?: string } };
  return pgError.constraint ?? pgError.cause?.constraint;
}

function isCostCentreUniqueViolation(error: unknown): boolean {
  const constraint = pgErrorConstraint(error);
  return pgErrorCode(error) === '23505' && typeof constraint === 'string' && constraint.includes('cost_centre_code');
}

function isCostCentreForeignKeyViolation(error: unknown): boolean {
  const constraint = pgErrorConstraint(error);
  return pgErrorCode(error) === '23503' && typeof constraint === 'string' && constraint.includes('cost_centre_code');
}

export function listProjectGroups(db: Db): Promise<ProjectGroup[]> {
  return db.select().from(schema.projectGroup).orderBy(schema.projectGroup.name);
}

export async function getProjectGroup(db: Db, id: string): Promise<ProjectGroup | null> {
  const [row] = await db.select().from(schema.projectGroup).where(eq(schema.projectGroup.id, id));
  return row ?? null;
}

export async function createProjectGroup(db: Db, input: ProjectGroupInput): Promise<ProjectGroup> {
  try {
    const [row] = await db.insert(schema.projectGroup).values({ id: randomUUID(), ...input }).returning();
    return row;
  } catch (error) {
    if (isCostCentreUniqueViolation(error)) throw new CostCentreAlreadyMappedError(input.costCentreCode ?? '');
    if (isCostCentreForeignKeyViolation(error)) throw new UnknownCostCentreError(input.costCentreCode ?? '');
    throw error;
  }
}

export async function updateProjectGroup(db: Db, input: ProjectGroupInput & { id: string }): Promise<ProjectGroup> {
  const { id, ...fields } = input;
  try {
    const [row] = await db.update(schema.projectGroup).set(fields).where(eq(schema.projectGroup.id, id)).returning();
    if (!row) throw new ProjectGroupNotFoundError(id);
    return row;
  } catch (error) {
    if (isCostCentreUniqueViolation(error)) throw new CostCentreAlreadyMappedError(input.costCentreCode ?? '');
    if (isCostCentreForeignKeyViolation(error)) throw new UnknownCostCentreError(input.costCentreCode ?? '');
    throw error;
  }
}

export async function findOrCreateProjectGroupByName(db: Db, name: string): Promise<ProjectGroup> {
  const [existing] = await db.select().from(schema.projectGroup).where(sql`lower(${schema.projectGroup.name}) = lower(${name})`);
  if (existing) return existing;
  return createProjectGroup(db, { name, costCentreCode: null, parentId: null });
}
