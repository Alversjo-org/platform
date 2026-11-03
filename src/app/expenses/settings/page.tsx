import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getDb } from '@/db';
import { formatIban } from '@/lib/expenses/bank-details';
import { getExpenseSettings } from '@/lib/expenses/settings';
import { requireTreasurer } from '@/lib/session';
import { saveExpenseSettingsAction } from '../actions';

export const dynamic = 'force-dynamic';

function Field({ name, label, value, hint, ...rest }: { name: string; label: string; value: string | number; hint?: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="space-y-1">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} defaultValue={value} {...rest} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default async function ExpenseSettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const treasurer = await requireTreasurer();
  const { error, saved } = await searchParams;
  const s = await getExpenseSettings(await getDb());

  return (
    <AppShell user={treasurer}>
      <p className="mb-2 text-sm"><Link href="/expenses/review" className="underline">← Review outlays</Link></p>
      <h1 className="mb-4 text-xl font-semibold">Outlay settings</h1>
      {error && <Alert variant="destructive" className="mb-4 max-w-2xl"><AlertDescription>{error}</AlertDescription></Alert>}
      {saved && !error && <Alert className="mb-4 max-w-2xl"><AlertDescription>Saved.</AlertDescription></Alert>}
      <form action={saveExpenseSettingsAction} className="max-w-2xl space-y-4">
        <Card>
          <CardHeader><CardTitle>Paying account (payment file)</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field name="debtorName" label="Association name" value={s.debtorName} maxLength={70} />
            <Field name="debtorOrgNumber" label="Organisation number" value={s.debtorOrgNumber} placeholder="802000-0000" />
            <Field name="debtorIban" label="IBAN of the account paying out" value={s.debtorIban ? formatIban(s.debtorIban) : ''} />
            <Field name="debtorBic" label="Bank BIC" value={s.debtorBic} placeholder="ESSESESS" />
            <Field name="bankCustomerId" label="Bank customer / agreement id (if the bank asks)" value={s.bankCustomerId}
              hint="Some banks want their agreement id as the file's initiating party; without it the organisation number is used." />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Booking in Fortnox</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field name="defaultCostAccount" label="Default cost account" value={s.defaultCostAccount} inputMode="numeric" hint="Suggested at approval; can be changed per outlay." />
            <Field name="vatAccount" label="Input VAT account" value={s.vatAccount} inputMode="numeric" />
            <Field name="liabilityAccount" label="Owed to members" value={s.liabilityAccount} inputMode="numeric" hint="Credited at approval, cleared at payout." />
            <Field name="bankLedgerAccount" label="Bank account (ledger)" value={s.bankLedgerAccount} inputMode="numeric" />
            <Field name="outlaySeries" label="Voucher series, outlays" value={s.outlaySeries} />
            <Field name="payoutSeries" label="Voucher series, payouts" value={s.payoutSeries} />
            <p className="text-xs text-muted-foreground sm:col-span-2">Missing voucher series are created in Fortnox on first use.</p>
          </CardContent>
        </Card>
        <Button type="submit">Save</Button>
      </form>
    </AppShell>
  );
}
