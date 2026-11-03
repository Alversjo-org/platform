'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { askRenewalsAction } from './actions';

/** "Ask all N to renew", behind a confirmation: it emails real members. */
export function AskRenewals({ count }: { count: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="lg" className="w-full" onClick={() => setOpen(true)}>Ask all {count} to renew</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup>
          <DialogTitle>Email {count} {count === 1 ? 'member' : 'members'}?</DialogTitle>
          <p className="text-sm text-ink-soft">
            Each gets the renewal message from “Edit renewal message”, and their last-contacted date is set to today.
          </p>
          <form action={askRenewalsAction} className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit">Send {count} {count === 1 ? 'email' : 'emails'}</Button>
          </form>
        </DialogPopup>
      </Dialog>
    </>
  );
}
