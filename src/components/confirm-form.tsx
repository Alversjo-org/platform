'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogPopup, DialogTitle } from '@/components/ui/dialog';

/** A button that asks before it submits a server action (for things that are hard to undo). */
export function ConfirmForm({ action, fields, trigger, title, body, confirm, size = 'lg', variant = 'default' }: {
  action: (formData: FormData) => Promise<void>;
  fields: Record<string, string>;
  trigger: string;
  title: string;
  body: string;
  confirm: string;
  size?: 'default' | 'lg';
  variant?: 'default' | 'outline' | 'destructive';
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)}>{trigger}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup>
          <DialogTitle>{title}</DialogTitle>
          <p className="text-sm text-ink-soft">{body}</p>
          <form action={action} className="mt-4 flex justify-end gap-2">
            {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant={variant === 'destructive' ? 'destructive' : 'default'}>{confirm}</Button>
          </form>
        </DialogPopup>
      </Dialog>
    </>
  );
}
