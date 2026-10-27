import { notFound, redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { AddSectionToggle } from '@/components/events/add-section-toggle';
import { AreaCheckboxes } from '@/components/events/area-checkboxes';
import { CapacityFieldset } from '@/components/events/capacity-fieldset';
import { DateRangeFields } from '@/components/events/date-range-fields';
import { getDb } from '@/db';
import { listAreas } from '@/lib/areas/service';
import { listEventAreas } from '@/lib/areas/booking-service';
import { getEventDetails } from '@/lib/events/details-service';
import { assertEventPermission, getEventRole, NotAuthorizedError } from '@/lib/projects/authorization';
import { ALLOWED_TRANSITIONS, getProjectBySlug } from '@/lib/projects/service';
import { requireUser } from '@/lib/session';
import { oreToSek } from '@/lib/money';
import { splitStockholmDateAndTime, utcToStockholmWallClock } from '@/lib/timezone';
import { archiveEventAction, cancelEventAction, closeEventAction, publishAction } from '../actions';
import { bookAreasAction, removeAreaAction, updateEventDetailsAction, updateEventMetaAction } from './actions';

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
  const role = await getEventRole(db, project.id, user);
  const canManage = role === 'lead' || role === 'override';
  const allowedNext = ALLOWED_TRANSITIONS[project.status];
  const details = await getEventDetails(db, project.id);
  const bookings = await listEventAreas(db, project.id);
  const areas = await listAreas(db);
  const starts = details ? splitStockholmDateAndTime(details.startsAt) : { date: '', time: null };
  const ends = details ? splitStockholmDateAndTime(details.endsAt) : { date: '', time: null };

  return (
    <AppShell user={user}>
      <div className="mb-4 flex items-center gap-2">
        <h1 className="text-xl font-semibold">Edit: {project.title}</h1>
        <Badge variant="secondary">{project.status}</Badge>
      </div>
      {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}
      {warning && <Alert className="mb-4"><AlertDescription>{warning}</AlertDescription></Alert>}

      {canManage && (allowedNext.includes('published') || allowedNext.includes('cancelled') || allowedNext.includes('closed') || allowedNext.includes('archived')) && (
        <div className="mb-6 flex flex-wrap gap-2">
          {allowedNext.includes('published') && <form action={publishAction}><input type="hidden" name="slug" value={slug} /><Button type="submit" size="sm">Publish</Button></form>}
          {allowedNext.includes('cancelled') && <form action={cancelEventAction}><input type="hidden" name="slug" value={slug} /><Button type="submit" size="sm" variant="secondary">Cancel event</Button></form>}
          {allowedNext.includes('closed') && <form action={closeEventAction}><input type="hidden" name="slug" value={slug} /><Button type="submit" size="sm" variant="secondary">Close</Button></form>}
          {allowedNext.includes('archived') && <form action={archiveEventAction}><input type="hidden" name="slug" value={slug} /><Button type="submit" size="sm" variant="secondary">Archive</Button></form>}
        </div>
      )}

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
            <DateRangeFields defaultStartsDate={starts.date} defaultEndsDate={ends.date} />
            <AddSectionToggle label="+ Add time" defaultOpen={!!(starts.time || ends.time)}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="startsTime">Starts at</Label><Input id="startsTime" name="startsTime" type="time" defaultValue={starts.time ?? ''} /></div>
                <div className="space-y-2"><Label htmlFor="endsTime">Ends at</Label><Input id="endsTime" name="endsTime" type="time" defaultValue={ends.time ?? ''} /></div>
              </div>
            </AddSectionToggle>
            <CapacityFieldset defaultHasLimit={details?.hasCapacityLimit ?? true} defaultCapacity={details?.capacity ?? ''} />
            <AddSectionToggle label="+ Add Sign-up window" defaultOpen={!!(details?.signupOpensAt || details?.signupClosesAt)}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="signupOpensAt">Sign-up opens (Europe/Stockholm)</Label><Input id="signupOpensAt" name="signupOpensAt" type="datetime-local" defaultValue={toLocalInput(details?.signupOpensAt)} /></div>
                <div className="space-y-2"><Label htmlFor="signupClosesAt">Sign-up closes (Europe/Stockholm)</Label><Input id="signupClosesAt" name="signupClosesAt" type="datetime-local" defaultValue={toLocalInput(details?.signupClosesAt)} /></div>
              </div>
            </AddSectionToggle>
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
        <CardContent className="space-y-4">
          {bookings.length > 0 && (
            <Table>
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
          )}
          <AddSectionToggle label="+ Add area" defaultOpen={false}>
            <form action={bookAreasAction} className="space-y-4">
              <input type="hidden" name="slug" value={slug} />
              <AreaCheckboxes areas={areas.filter((a) => !bookings.some((b) => b.areaId === a.id))} />
              <Button type="submit">Book areas</Button>
            </form>
          </AddSectionToggle>
        </CardContent>
      </Card>
    </AppShell>
  );
}
