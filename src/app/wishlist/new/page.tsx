import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { requireUser } from '@/lib/session';
import { createPurchaseProjectAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function NewWishlistItemPage() {
  const user = await requireUser();
  return (
    <AppShell user={user}>
      <h1 className="mb-4 text-xl font-semibold">Add wishlist item</h1>
      <form action={createPurchaseProjectAction} className="max-w-xl space-y-4">
        <div className="space-y-2"><Label htmlFor="title">Title</Label><Input id="title" name="title" required /></div>
        <div className="space-y-2"><Label htmlFor="summary">Summary</Label><Textarea id="summary" name="summary" /></div>
        <div className="space-y-2"><Label htmlFor="body">Details</Label><Textarea id="body" name="body" rows={6} /></div>
        <Button type="submit">Add</Button>
      </form>
    </AppShell>
  );
}
