import type { ExpenseStatus } from '@/db/schema';

/** 123450 → "1 234,50 kr" (Swedish formatting). */
export function formatSek(ore: number): string {
  return `${new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(ore / 100)} kr`;
}

/** 123450 → "1234,50", for form inputs. */
export function oreToInput(ore: number | null | undefined): string {
  return ore === null || ore === undefined ? '' : (ore / 100).toFixed(2).replace('.', ',');
}

export const STATUS_LABELS: Record<ExpenseStatus, string> = {
  submitted: 'Waiting for approval',
  approved: 'Approved, to be paid',
  rejected: 'Not approved',
  paid: 'Paid',
};
