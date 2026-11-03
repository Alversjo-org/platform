import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getDb } from '@/db';
import { getBankAccountSummary } from '@/lib/expenses/bank-account-service';
import { maskedLabel } from '@/lib/expenses/bank-details';
import { requireUser } from '@/lib/session';
import { utcToStockholmWallClock } from '@/lib/timezone';
import { deleteBankAccountAction, saveBankAccountAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function BankAccountPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string; kind?: string; edit?: string }> }) {
  const user = await requireUser();
  const { error, saved, kind: kindParam, edit } = await searchParams;
  const account = await getBankAccountSummary(await getDb(), user.id);
  const kind = kindParam === 'se' ? 'se' : 'iban';
  const showForm = !account || edit === '1' || Boolean(error);

  return (
    <AppShell user={user} className="md:px-20">
      <p className="mb-2 text-sm"><Link href="/profile" className="underline">← Profile</Link></p>
      <Card className="max-w-md">
        <CardHeader><CardTitle>Payout bank account</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Where Alversjö pays back your <Link href="/expenses" className="underline">outlays</Link>. The number is stored
            encrypted and only goes into the payment file sent to the bank; after saving, only its last four digits are shown,
            also to the treasurer. You get an email whenever it changes.
          </p>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          {saved && !error && <Alert><AlertDescription>Saved. We’ve sent you an email confirming the change.</AlertDescription></Alert>}

          {account && (
            <div className="rounded-md border p-3 text-sm">
              <p className="font-medium">{maskedLabel(account.kind, account.last4)}</p>
              <p className="text-muted-foreground">{account.holderName} · updated {utcToStockholmWallClock(account.updatedAt).replace('T', ' ')}</p>
              {!showForm && (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/profile/bank?edit=1" />}>Replace</Button>
                  <form action={deleteBankAccountAction}><Button type="submit" size="sm" variant="ghost">Remove</Button></form>
                </div>
              )}
            </div>
          )}

          {showForm && (
            <>
              <div className="flex gap-4 text-sm">
                <Link href="/profile/bank?kind=iban&edit=1" className={kind === 'iban' ? 'font-medium underline' : 'text-muted-foreground'}>IBAN</Link>
                <Link href="/profile/bank?kind=se&edit=1" className={kind === 'se' ? 'font-medium underline' : 'text-muted-foreground'}>Swedish clearing + account number</Link>
              </div>
              <form action={saveBankAccountAction} className="space-y-4" autoComplete="off">
                <input type="hidden" name="kind" value={kind} />
                <div className="space-y-2"><Label htmlFor="holderName">Account holder</Label><Input id="holderName" name="holderName" required maxLength={70} /></div>
                {kind === 'iban' ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="iban">IBAN</Label>
                      <Input id="iban" name="iban" required placeholder="SE45 5000 0000 0583 9825 7466" inputMode="text" autoCapitalize="characters" spellCheck={false} />
                      <p className="text-xs text-muted-foreground">Your bank app shows it under the account’s details.</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bic">BIC / SWIFT (needed outside Sweden)</Label>
                      <Input id="bic" name="bic" placeholder="ESSESESS" autoCapitalize="characters" spellCheck={false} />
                    </div>
                  </>
                ) : (
                  <div className="grid grid-cols-[7rem_1fr] gap-3">
                    <div className="space-y-2"><Label htmlFor="clearing">Clearing no.</Label><Input id="clearing" name="clearing" required inputMode="numeric" placeholder="6123" /></div>
                    <div className="space-y-2"><Label htmlFor="account">Account no.</Label><Input id="account" name="account" required inputMode="numeric" placeholder="123 456 789" /></div>
                  </div>
                )}
                <div className="flex gap-2">
                  <Button type="submit">Save</Button>
                  {account && <Button variant="ghost" nativeButton={false} render={<Link href="/profile/bank" />}>Cancel</Button>}
                </div>
              </form>
            </>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
