import { notFound, redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { getDb } from '@/db';
import { listAreas } from '@/lib/areas/service';
import { listEventAreas } from '@/lib/areas/booking-service';
import { getEventDetails } from '@/lib/events/details-service';
import { assertEventPermission, NotAuthorizedError } from '@/lib/projects/authorization';
import { getProjectBySlug } from '@/lib/projects/service';
import { requireUser } from '@/lib/session';
import { oreToSek } from '@/lib/money';
import { splitStockholmDateAndTime, utcToStockholmWallClock } from '@/lib/timezone';
import { bookAreaAction, removeAreaAction, updateEventDetailsAction, updateEventMetaAction } from './actions';

export const dynamic = 'force-dynamic';

function toLocalInput(date: Date | null | undefined): string {
  return date ? utcToStockholmWallClock(date) : '';
}

export default async function EditEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string; warning?: string }>;
}) {
  const { slug } = await params;
  const { error, warning } = await searchParams;
  const user = await requireUser();
  const db = await getDb();
  const project = await getProjectBySlug(db, slug);
  if (!project) notFound();
  try {
    await assertEventPermission(db, project.id, user, 'editDetails');
  } catch (e) {
    if (e instanceof NotAuthorizedError) redirect('/events');
    throw e;
  }
  const details = await getEventDetails(db, project.id);
  const bookings = await listEventAreas(db, project.id);
  const areas = await listAreas(db);
  const starts = details ? splitStockholmDateAndTime(details.startsAt) : { date: '', time: null };
  const ends = details ? splitStockholmDateAndTime(details.endsAt) : { date: '', time: null };

  return (
    <AppShell user={user}>
      <h1 className="mb-4 text-xl font-semibold">Edit: {project.title}</h1>
      {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}
      {warning && <Alert className="mb-4"><AlertDescription>{warning}</AlertDescription></Alert>}

      <Card className="mb-6">
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent>
          <form action={updateEventMetaAction} className="space-y-4">
            <input type="hidden" name="slug" value={slug} />
            <div className="space-y-2"><Label htmlFor="title">Title</Label><Input id="title" name="title" defaultValue={project.title} /></div>
            <div className="space-y-2"><Label htmlFor="summary">Summary</Label><Textarea id="summary" name="summary" defaultValue={project.summary} /></div>
            <div className="space-y-2"><Label htmlFor="body">Body</Label><Textarea id="body" name="body" rows={6} defaultValue={project.body} /></div>
            <Button type="submit">Save details</Button>
          </form>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader><CardTitle>When, capacity & price</CardTitle></CardHeader>
        <CardContent>
          <form action={updateEventDetailsAction} className="space-y-4">
            <input type="hidden" name="slug" value={slug} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="startsDate">Starts (Europe/Stockholm)</Label><Input id="startsDate" name="startsDate" type="date" defaultValue={starts.date} required /></div>
              <div className="space-y-2"><Label htmlFor="endsDate">Ends (Europe/Stockholm)</Label><Input id="endsDate" name="endsDate" type="date" defaultValue={ends.date} required /></div>
            </div>
            <details open={!!(starts.time || ends.time)}>
              <summary className="cursor-pointer text-sm underline">+ Add a specific time (optional — defaults to all day)</summary>
              <div className="mt-2 grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="startsTime">Starts at</Label><Input id="startsTime" name="startsTime" type="time" defaultValue={starts.time ?? ''} /></div>
                <div className="space-y-2"><Label htmlFor="endsTime">Ends at</Label><Input id="endsTime" name="endsTime" type="time" defaultValue={ends.time ?? ''} /></div>
              </div>
            </details>
            <fieldset className="space-y-2">
              <Label>Capacity</Label>
              <div className="flex items-center gap-2">
                <input type="radio" id="capacityLimited" name="capacityMode" value="limited" defaultChecked={details?.hasCapacityLimit ?? true} />
                <Label htmlFor="capacityLimited">Limited to</Label>
                <Input name="capacity" type="number" min={1} className="w-24" defaultValue={details?.capacity ?? ''} />
              </div>
              <div className="flex items-center gap-2">
                <input type="radio" id="capacityUnlimited" name="capacityMode" value="unlimited" defaultChecked={details ? !details.hasCapacityLimit : false} />
                <Label htmlFor="capacityUnlimited">No limit</Label>
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="signupOpensAt">Sign-up opens (Europe/Stockholm)</Label><Input id="signupOpensAt" name="signupOpensAt" type="datetime-local" defaultValue={toLocalInput(details?.signupOpensAt)} /></div>
              <div className="space-y-2"><Label htmlFor="signupClosesAt">Sign-up closes (Europe/Stockholm)</Label><Input id="signupClosesAt" name="signupClosesAt" type="datetime-local" defaultValue={toLocalInput(details?.signupClosesAt)} /></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="priceKr">Price (SEK, 0 = free)</Label><Input id="priceKr" name="priceKr" type="number" min={0} step="0.01" defaultValue={details ? oreToSek(details.priceSek) : 0} /></div>
              <div className="space-y-2"><Label htmlFor="priceNote">Price note</Label><Input id="priceNote" name="priceNote" defaultValue={details?.priceNote ?? ''} /></div>
            </div>
            <div className="space-y-2"><Label htmlFor="contactNote">Contact note</Label><Textarea id="contactNote" name="contactNote" defaultValue={details?.contactNote ?? ''} /></div>
            <div className="flex items-center gap-2">
              <Checkbox id="showSignupsToParticipants" name="showSignupsToParticipants" defaultChecked={details?.showSignupsToParticipants ?? false} />
              <Label htmlFor="showSignupsToParticipants">Show sign-up list to other participants</Label>
            </div>
            <Button type="submit">Save</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Areas</CardTitle></CardHeader>
        <CardContent>
          <details open={bookings.length > 0}>
            <summary className="cursor-pointer text-sm underline">+ Areas (optional — not required to publish)</summary>
            <div className="mt-4">
              <Table className="mb-4">
                <TableHeader><TableRow><TableHead>Area</TableHead><TableHead>From</TableHead><TableHead>To</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>
                  {bookings.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell>{areas.find((a) => a.id === b.areaId)?.name ?? b.areaId}</TableCell>
                      <TableCell>{toLocalInput(b.from)}</TableCell>
                      <TableCell>{toLocalInput(b.to)}</TableCell>
                      <TableCell className="text-right">
                        <form action={removeAreaAction}>
                          <input type="hidden" name="slug" value={slug} />
                          <input type="hidden" name="eventAreaId" value={b.id} />
                          <button type="submit" className="text-sm underline">Remove</button>
                        </form>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <form action={bookAreaAction} className="grid gap-4 sm:grid-cols-2">
                <input type="hidden" name="slug" value={slug} />
                <div className="space-y-2">
                  <Label htmlFor="areaId">Area</Label>
                  <select id="areaId" name="areaId" className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm" required>
                    {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2"><Label htmlFor="setupNote">Setup note</Label><Input id="setupNote" name="setupNote" /></div>
                <div className="space-y-2"><Label htmlFor="from">From (Europe/Stockholm)</Label><Input id="from" name="from" type="datetime-local" required /></div>
                <div className="space-y-2"><Label htmlFor="to">To (Europe/Stockholm)</Label><Input id="to" name="to" type="datetime-local" required /></div>
                <Button type="submit" className="sm:col-span-2">Book area</Button>
              </form>
            </div>
          </details>
        </CardContent>
      </Card>
    </AppShell>
  );
}
