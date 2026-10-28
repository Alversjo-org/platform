import type { BudgetLineKind } from '@/db/schema';
import { parseCsv } from '@/lib/csv';
import { sekToOre } from '@/lib/money';

export type ParsedBudgetLine = { description: string; kind: BudgetLineKind; groupName: string | null; amountSek: number };
export type ParsedBudgetCsv = { fiscalYear: number; lines: ParsedBudgetLine[]; skippedTotalLabels: string[] };

export class InvalidBudgetCsvError extends Error {
  constructor(message: string) { super(message); this.name = 'InvalidBudgetCsvError'; }
}

export function parseBudgetCsv(csvText: string): ParsedBudgetCsv {
  const rows = parseCsv(csvText);
  const [yearLabel, yearRaw] = rows[0] ?? [];
  if (yearLabel?.trim().toLowerCase() !== 'year' || !yearRaw || !/^\d+$/.test(yearRaw.trim())) {
    throw new InvalidBudgetCsvError('Row 1 must be YEAR,<integer>');
  }
  const fiscalYear = Number(yearRaw.trim());

  const lines: ParsedBudgetLine[] = [];
  const skippedTotalLabels: string[] = [];
  let currentKind: BudgetLineKind = 'allocation';
  let currentGroup: string | null = null;

  for (const [label, amountRaw] of rows.slice(1)) {
    const normalized = label.trim().toLowerCase();

    if (normalized === 'costs') { currentKind = 'cost'; currentGroup = null; continue; }
    if (normalized === 'revenue' || normalized === 'income') { currentKind = 'income'; currentGroup = null; continue; }
    if (normalized === 'result') { currentKind = 'allocation'; currentGroup = null; continue; }

    if (normalized.startsWith('total')) {
      skippedTotalLabels.push(label.trim());
      continue;
    }

    if (!amountRaw || amountRaw.trim() === '') {
      currentGroup = label.trim();
      continue;
    }

    const amount = Number.parseFloat(amountRaw);
    if (Number.isNaN(amount)) throw new InvalidBudgetCsvError(`Invalid amount for row "${label}": ${amountRaw}`);

    lines.push({ description: label.trim(), kind: currentKind, groupName: currentGroup, amountSek: sekToOre(amount) });
  }

  return { fiscalYear, lines, skippedTotalLabels };
}
