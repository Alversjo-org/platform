import { AppShell } from '@/components/app-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
      <form action={createEventAction} className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2"><Label htmlFor="title">Title</Label><Input id="title" name="title" required /></div>
            <div className="space-y-2"><Label htmlFor="summary">Summary</Label><Textarea id="summary" name="summary" /></div>
            <div className="space-y-2"><Label htmlFor="body">Body</Label><Textarea id="body" name="body" rows={6} /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>When, capacity & price</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="startsDate">Starts (Europe/Stockholm)</Label><Input id="startsDate" name="startsDate" type="date" required /></div>
              <div className="space-y-2"><Label htmlFor="endsDate">Ends (Europe/Stockholm)</Label><Input id="endsDate" name="endsDate" type="date" required /></div>
            </div>
            <details>
              <summary className="cursor-pointer text-sm underline">+ Add a specific time (optional — defaults to all day)</summary>
              <div className="mt-2 grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="startsTime">Starts at</Label><Input id="startsTime" name="startsTime" type="time" /></div>
                <div className="space-y-2"><Label htmlFor="endsTime">Ends at</Label><Input id="endsTime" name="endsTime" type="time" /></div>
              </div>
            </details>
            <fieldset className="space-y-2">
              <Label>Capacity</Label>
              <div className="flex items-center gap-2">
                <input type="radio" id="capacityLimited" name="capacityMode" value="limited" defaultChecked />
                <Label htmlFor="capacityLimited">Limited to</Label>
                <Input name="capacity" type="number" min={1} className="w-24" />
              </div>
              <div className="flex items-center gap-2">
                <input type="radio" id="capacityUnlimited" name="capacityMode" value="unlimited" />
                <Label htmlFor="capacityUnlimited">No limit</Label>
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="signupOpensAt">Sign-up opens (Europe/Stockholm)</Label><Input id="signupOpensAt" name="signupOpensAt" type="datetime-local" /></div>
              <div className="space-y-2"><Label htmlFor="signupClosesAt">Sign-up closes (Europe/Stockholm)</Label><Input id="signupClosesAt" name="signupClosesAt" type="datetime-local" /></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="priceKr">Price (SEK, 0 = free)</Label><Input id="priceKr" name="priceKr" type="number" min={0} step="0.01" defaultValue={0} /></div>
              <div className="space-y-2"><Label htmlFor="priceNote">Price note</Label><Input id="priceNote" name="priceNote" /></div>
            </div>
            <div className="space-y-2"><Label htmlFor="contactNote">Contact note</Label><Textarea id="contactNote" name="contactNote" /></div>
          </CardContent>
        </Card>

        <Button type="submit">Create event</Button>
      </form>
    </AppShell>
  );
}
