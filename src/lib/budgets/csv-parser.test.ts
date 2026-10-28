import { describe, expect, it } from 'vitest';
import { InvalidBudgetCsvError, parseBudgetCsv } from './csv-parser';

const SAMPLE = `YEAR,2026
required principal repayments,185600
COSTS,
Financial Costs,
Interest,228000
Operating Costs,
Electricity,50000
Water and Sewage,0
Land activation fund,
2 x microgrant events (October & November),200000
Total Costs,1515126
REVENUE,
Events,
Borderland,2172800
Total Revenue,2686516
RESULT,1171390
tax 20.6%,241306.34
proposed extra bank loan repayment,750000`;

describe('parseBudgetCsv', () => {
  it('parses the fiscal year from row 1', () => {
    expect(parseBudgetCsv(SAMPLE).fiscalYear).toBe(2026);
  });

  it('throws for a missing or malformed YEAR row', () => {
    expect(() => parseBudgetCsv('NOT_YEAR,2026\nCOSTS,')).toThrow(InvalidBudgetCsvError);
  });

  it('groups leaf lines under the nearest preceding blank-value row within the current section', () => {
    const { lines } = parseBudgetCsv(SAMPLE);
    expect(lines.filter((l) => l.groupName === 'Operating Costs').map((l) => l.description)).toEqual(['Electricity', 'Water and Sewage']);
    expect(lines.find((l) => l.description === '2 x microgrant events (October & November)')?.groupName).toBe('Land activation fund');
  });

  it('defaults to allocation for a line before any section marker, and after RESULT', () => {
    const { lines } = parseBudgetCsv(SAMPLE);
    expect(lines.find((l) => l.description === 'required principal repayments')).toMatchObject({ kind: 'allocation', groupName: null });
    expect(lines.find((l) => l.description === 'proposed extra bank loan repayment')).toMatchObject({ kind: 'allocation', groupName: null });
    expect(lines.find((l) => l.description === 'tax 20.6%')).toMatchObject({ kind: 'allocation' });
  });

  it('assigns cost and income kinds from the COSTS/REVENUE markers', () => {
    const { lines } = parseBudgetCsv(SAMPLE);
    expect(lines.find((l) => l.description === 'Interest')).toMatchObject({ kind: 'cost' });
    expect(lines.find((l) => l.description === 'Borderland')).toMatchObject({ kind: 'income' });
  });

  it('keeps a zero-amount line as a line, not a group header', () => {
    const { lines } = parseBudgetCsv(SAMPLE);
    expect(lines.find((l) => l.description === 'Water and Sewage')).toMatchObject({ amountSek: 0 });
  });

  it('skips Total rows and records their labels instead of importing them as lines', () => {
    const { lines, skippedTotalLabels } = parseBudgetCsv(SAMPLE);
    expect(lines.some((l) => l.description.toLowerCase().startsWith('total'))).toBe(false);
    expect(skippedTotalLabels).toEqual(['Total Costs', 'Total Revenue']);
  });

  it('converts amounts to öre, rounding sub-öre fractions', () => {
    const { lines } = parseBudgetCsv(SAMPLE);
    expect(lines.find((l) => l.description === 'tax 20.6%')).toMatchObject({ amountSek: 24_130_634 });
  });
});
