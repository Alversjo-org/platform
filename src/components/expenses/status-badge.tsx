import { Badge } from '@/components/ui/badge';
import type { ExpenseStatus } from '@/db/schema';
import { STATUS_LABELS } from '@/lib/expenses/format';

const VARIANT: Record<ExpenseStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  submitted: 'outline', approved: 'secondary', rejected: 'destructive', paid: 'default',
};

export function ExpenseStatusBadge({ status }: { status: ExpenseStatus }) {
  return <Badge variant={VARIANT[status]}>{STATUS_LABELS[status]}</Badge>;
}
