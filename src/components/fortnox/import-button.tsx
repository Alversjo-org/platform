'use client';

import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';

export function ImportButton({ running }: { running: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={running || pending}>
      {running ? 'Importing…' : pending ? 'Starting…' : 'Run first import'}
    </Button>
  );
}
