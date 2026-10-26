import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getDb } from '@/db';
import { listAreas } from '@/lib/areas/service';
import { requireMapper } from '@/lib/session';
import { createAreaAction, updateAreaAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function AreasPage() {
  const admin = await requireMapper();
  const areas = await listAreas(await getDb());
  return (
    <AppShell user={admin}>
      <h1 className="mb-4 text-xl font-semibold">Areas</h1>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead><TableHead>Description</TableHead><TableHead>Capacity</TableHead>
            <TableHead>Bookable</TableHead><TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {areas.map((a) => (
            <TableRow key={a.id}>
              <TableCell>{a.name}</TableCell>
              <TableCell>{a.description || '—'}</TableCell>
              <TableCell>{a.capacity ?? '—'}</TableCell>
              <TableCell>{a.bookable ? 'Yes' : 'No'}</TableCell>
              <TableCell className="text-right">
                <Link href={`/areas/${a.id}/cells`} className="mr-4 text-sm underline">Edit cells on map</Link>
                <details>
                  <summary className="cursor-pointer text-sm underline">Edit</summary>
                  <form action={updateAreaAction} className="mt-2 space-y-2 text-left">
                    <input type="hidden" name="id" value={a.id} />
                    <Input name="name" defaultValue={a.name} placeholder="Name" />
                    <Input name="description" defaultValue={a.description} placeholder="Description" />
                    <Input name="capacity" type="number" defaultValue={a.capacity ?? ''} placeholder="Capacity (optional)" />
                    <div className="flex items-center gap-2">
                      <Checkbox id={`bookable-${a.id}`} name="bookable" defaultChecked={a.bookable} />
                      <Label htmlFor={`bookable-${a.id}`}>Bookable</Label>
                    </div>
                    <Button type="submit" size="sm">Save</Button>
                  </form>
                </details>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Card className="mt-6">
        <CardHeader><CardTitle>Add area</CardTitle></CardHeader>
        <CardContent>
          <form action={createAreaAction} className="space-y-2">
            <div className="space-y-2"><Label htmlFor="name">Name</Label><Input id="name" name="name" required /></div>
            <div className="space-y-2"><Label htmlFor="description">Description</Label><Input id="description" name="description" /></div>
            <div className="space-y-2"><Label htmlFor="capacity">Capacity (optional)</Label><Input id="capacity" name="capacity" type="number" /></div>
            <div className="flex items-center gap-2"><Checkbox id="bookable" name="bookable" defaultChecked /><Label htmlFor="bookable">Bookable</Label></div>
            <Button type="submit">Add area</Button>
          </form>
        </CardContent>
      </Card>
    </AppShell>
  );
}
