'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import { DraftNotEmptyError, importBudgetCsv } from '@/lib/budgets/service';
import { InvalidBudgetCsvError } from '@/lib/budgets/csv-parser';
import { requireTreasurer } from '@/lib/session';

export async function importBudgetCsvAction(formData: FormData) {
  await requireTreasurer();
  const csv = String(formData.get('csv') ?? '');

  let result;
  try {
    result = await importBudgetCsv(await getDb(), csv);
  } catch (e) {
    if (e instanceof DraftNotEmptyError) {
      redirect(`/budget/import?error=${encodeURIComponent(`${e.message} — clear or approve the existing draft on /budget first.`)}`);
    }
    if (e instanceof InvalidBudgetCsvError) {
      redirect(`/budget/import?error=${encodeURIComponent(e.message)}`);
    }
    throw e;
  }

  const params = new URLSearchParams({
    year: String(result.annualBudget.fiscalYear),
    imported: String(result.linesImported),
    groupsCreated: String(result.groupsCreated),
  });
  redirect(`/budget?${params.toString()}`);
}
