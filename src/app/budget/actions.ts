'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import type { BudgetLineKind } from '@/db/schema';
import {
  approveBudget, BudgetVersionNotEditableError, deleteBudgetAmount, upsertBudgetAmount,
} from '@/lib/budgets/service';
import { sekToOre } from '@/lib/money';
import { requireTreasurer } from '@/lib/session';

function parseLineInput(formData: FormData) {
  const projectGroupIdRaw = String(formData.get('projectGroupId') ?? '').trim();
  const monthRaw = String(formData.get('month') ?? '').trim();
  return {
    description: String(formData.get('description') ?? '').trim(),
    projectGroupId: projectGroupIdRaw === '' ? null : projectGroupIdRaw,
    projectId: null,
    kind: String(formData.get('kind')) as BudgetLineKind,
    month: monthRaw === '' ? null : Number(monthRaw),
    amountSek: sekToOre(Number(formData.get('amountKr') ?? 0)),
    accountFrom: null,
    accountTo: null,
  };
}

function redirectWithYear(fiscalYear: string, error?: string): never {
  const params = new URLSearchParams({ year: fiscalYear });
  if (error) params.set('error', error);
  redirect(`/budget?${params.toString()}`);
}

export async function addLineAction(formData: FormData) {
  await requireTreasurer();
  const fiscalYear = String(formData.get('fiscalYear'));
  const annualBudgetId = String(formData.get('annualBudgetId'));
  try {
    await upsertBudgetAmount(await getDb(), { annualBudgetId, ...parseLineInput(formData) });
  } catch (e) {
    if (e instanceof BudgetVersionNotEditableError) redirectWithYear(fiscalYear, 'This budget is no longer editable — reload the page.');
    throw e;
  }
  revalidatePath('/budget');
  redirectWithYear(fiscalYear);
}

export async function updateLineAction(formData: FormData) {
  await requireTreasurer();
  const fiscalYear = String(formData.get('fiscalYear'));
  const annualBudgetId = String(formData.get('annualBudgetId'));
  const id = String(formData.get('id'));
  try {
    await upsertBudgetAmount(await getDb(), { id, annualBudgetId, ...parseLineInput(formData) });
  } catch (e) {
    if (e instanceof BudgetVersionNotEditableError) redirectWithYear(fiscalYear, 'This budget is no longer editable — reload the page.');
    throw e;
  }
  revalidatePath('/budget');
  redirectWithYear(fiscalYear);
}

export async function deleteLineAction(formData: FormData) {
  await requireTreasurer();
  const fiscalYear = String(formData.get('fiscalYear'));
  const id = String(formData.get('id'));
  try {
    await deleteBudgetAmount(await getDb(), id);
  } catch (e) {
    if (e instanceof BudgetVersionNotEditableError) redirectWithYear(fiscalYear, 'This budget is no longer editable — reload the page.');
    throw e;
  }
  revalidatePath('/budget');
  redirectWithYear(fiscalYear);
}

export async function approveAction(formData: FormData) {
  const treasurer = await requireTreasurer();
  const fiscalYear = String(formData.get('fiscalYear'));
  const annualBudgetId = String(formData.get('annualBudgetId'));
  try {
    await approveBudget(await getDb(), { annualBudgetId, actorUserId: treasurer.id });
  } catch (e) {
    if (e instanceof BudgetVersionNotEditableError) redirectWithYear(fiscalYear, 'This budget is no longer editable — reload the page.');
    throw e;
  }
  revalidatePath('/budget');
  redirectWithYear(fiscalYear);
}
