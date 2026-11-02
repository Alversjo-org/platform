import type { BudgetLineKind } from '@/db/schema';
import { parseCsv } from '@/lib/csv';
import { sekToOre } from '@/lib/money';

export type ParsedBudgetLine = { description: string; kind: BudgetLineKind; groupName: string | null; amountSek: number };
export type ParsedBudgetCsv = { fiscalYear: number; lines: ParsedBudgetLine[]; skippedTotalLabels: string[] };

export class InvalidBudgetCsvError extends Error {
  constructor(message: string) { super(message); this.name = 'InvalidBudgetCsvError'; }
}

/** Strips space/NBSP thousands grouping and a lone decimal comma, then requires a clean number — never guesses on an ambiguous or partially-numeric value. */
function parseAmount(raw: string, label: string): number {
  let normalized = raw.trim().replace(/[\s ]/g, '');
  const commaCount = (normalized.match(/,/g) ?? []).length;
  if (commaCount === 1) normalized = normalized.replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    throw new InvalidBudgetCsvError(`Invalid amount for row "${label}": ${raw}`);
  }
  return Number.parseFloat(normalized);
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
  let sawSectionMarker = false;

  for (const [label, amountRaw] of rows.slice(1)) {
    const normalized = label.trim().toLowerCase();

    if (normalized === 'costs') { currentKind = 'cost'; currentGroup = null; sawSectionMarker = true; continue; }
    if (normalized === 'revenue' || normalized === 'income') { currentKind = 'income'; currentGroup = null; sawSectionMarker = true; continue; }
    if (normalized === 'result') { currentKind = 'allocation'; currentGroup = null; sawSectionMarker = true; continue; }

    if (normalized.startsWith('total')) {
      skippedTotalLabels.push(label.trim());
      continue;
    }

    if (!amountRaw || amountRaw.trim() === '') {
      currentGroup = label.trim();
      continue;
    }

    const amountSek = sekToOre(parseAmount(amountRaw, label));
    lines.push({ description: label.trim(), kind: currentKind, groupName: currentGroup, amountSek });
  }

  if (lines.length === 0) throw new InvalidBudgetCsvError('No budget lines found in the CSV');
  if (!sawSectionMarker) throw new InvalidBudgetCsvError('No COSTS, REVENUE/INCOME or RESULT section header was recognized — check the CSV\'s section labels');

  return { fiscalYear, lines, skippedTotalLabels };
}
