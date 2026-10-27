'use client';

import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

/** A "+ Add X" button that reveals an optional form section when clicked. */
export function AddSectionToggle({ label, defaultOpen = false, children }: { label: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }
  return <div className="space-y-4">{children}</div>;
}
