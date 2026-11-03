'use client';

import { useState, useTransition } from 'react';
import { createExpenseAction, readReceiptAction } from '@/app/expenses/actions';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ReceiptSuggestion } from '@/lib/expenses/ocr';

type Project = { id: string; title: string };

function oreToInput(ore: number | null): string {
  return ore === null ? '' : (ore / 100).toFixed(2).replace('.', ',');
}

/** The member's outlay form: receipt files first, then fields the receipt reader may pre-fill. */
export function ExpenseForm({ projects, readerEnabled, today }: { projects: Project[]; readerEnabled: boolean; today: string }) {
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<ReceiptSuggestion | null>(null);
  const [reading, setReading] = useState(false);
  const [submitting, startSubmit] = useTransition();
  const [fields, setFields] = useState({ description: '', merchant: '', purchaseDate: '', total: '', vat: '' });
  const set = (k: keyof typeof fields) => (e: React.ChangeEvent<HTMLInputElement>) => setFields((f) => ({ ...f, [k]: e.target.value }));

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const first = e.target.files?.[0];
    setSuggestion(null);
    if (!first || !readerEnabled) return;
    setReading(true);
    const data = new FormData();
    data.append('receipt', first);
    const s = await readReceiptAction(data).catch(() => null);
    setReading(false);
    if (!s) return;
    setSuggestion(s);
    // Only fill what the member hasn't typed yet.
    setFields((f) => ({
      description: f.description || s.description,
      merchant: f.merchant || s.merchant,
      purchaseDate: f.purchaseDate || (s.purchaseDate ?? ''),
      total: f.total || (s.currency === 'SEK' ? oreToInput(s.totalOre) : ''),
      vat: f.vat || (s.currency === 'SEK' ? oreToInput(s.vatOre) : ''),
    }));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    if (suggestion) data.set('ocr', JSON.stringify(suggestion));
    setError(null);
    startSubmit(async () => {
      const result = await createExpenseAction(data);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="receipts">Receipt (photo or PDF)</Label>
        <Input id="receipts" name="receipts" type="file" accept="image/*,application/pdf" multiple required onChange={onFiles} />
        <p className="text-xs text-muted-foreground">
          Up to 5 files. The whole receipt must be readable: shop, date, what was bought, amount and VAT.
          {readerEnabled && ' The first file is read automatically to fill in the fields below — check them.'}
        </p>
        {reading && <p className="text-sm text-muted-foreground">Reading the receipt…</p>}
        {suggestion && suggestion.currency !== 'SEK' && (
          <Alert><AlertDescription>The receipt is in {suggestion.currency}. Enter what you paid in kronor (check your bank statement).</AlertDescription></Alert>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">What did you buy, and for what?</Label>
        <Input id="description" name="description" required maxLength={200} value={fields.description} onChange={set('description')} placeholder="Paint for the sauna" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="merchant">Shop</Label>
          <Input id="merchant" name="merchant" maxLength={100} value={fields.merchant} onChange={set('merchant')} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="purchaseDate">Purchase date</Label>
          <Input id="purchaseDate" name="purchaseDate" type="date" required max={today} value={fields.purchaseDate} onChange={set('purchaseDate')} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="total">Amount paid (kr, incl. VAT)</Label>
          <Input id="total" name="total" required inputMode="decimal" placeholder="249,90" value={fields.total} onChange={set('total')} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="vat">Of which VAT (kr)</Label>
          <Input id="vat" name="vat" inputMode="decimal" placeholder="49,98" value={fields.vat} onChange={set('vat')} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="projectId">Project</Label>
        <select id="projectId" name="projectId" defaultValue="" className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm">
          <option value="">No project / general</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="note">Note for the treasurer (optional)</Label>
        <Textarea id="note" name="note" rows={2} maxLength={1000} />
      </div>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <Button type="submit" disabled={submitting || reading}>{submitting ? 'Sending…' : 'Submit outlay'}</Button>
    </form>
  );
}
