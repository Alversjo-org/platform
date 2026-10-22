import { AppShell } from '@/components/app-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { requireUser } from '@/lib/session';
import { createEventAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function NewEventPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  const { error } = await searchParams;
  return (
    <AppShell user={user}>
      <h1 className="mb-4 text-xl font-semibold">New event</h1>
      {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}
      <form action={createEventAction} className="max-w-md space-y-4">
        <div className="space-y-2"><Label htmlFor="title">Title</Label><Input id="title" name="title" required /></div>
        <div className="space-y-2"><Label htmlFor="summary">Summary</Label><Textarea id="summary" name="summary" /></div>
        <Button type="submit">Create draft</Button>
      </form>
    </AppShell>
  );
}
