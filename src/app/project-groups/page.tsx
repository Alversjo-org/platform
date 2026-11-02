import { AppShell } from '@/components/app-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getDb } from '@/db';
import { listProjectGroups } from '@/lib/project-groups/service';
import { requireTreasurer } from '@/lib/session';
import { createProjectGroupAction, updateProjectGroupAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function ProjectGroupsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const treasurer = await requireTreasurer();
  const groups = await listProjectGroups(await getDb());
  const { error } = await searchParams;

  return (
    <AppShell user={treasurer}>
      <h1 className="mb-4 text-xl font-semibold">Project groups</h1>
      {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead><TableHead>Cost centre</TableHead><TableHead>Parent</TableHead><TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((g) => (
            <TableRow key={g.id}>
              <TableCell>{g.name}</TableCell>
              <TableCell>{g.costCentreCode ?? '—'}</TableCell>
              <TableCell>{groups.find((p) => p.id === g.parentId)?.name ?? '—'}</TableCell>
              <TableCell className="text-right">
                <details>
                  <summary className="cursor-pointer text-sm underline">Edit</summary>
                  <form action={updateProjectGroupAction} className="mt-2 space-y-2 text-left">
                    <input type="hidden" name="id" value={g.id} />
                    <Input name="name" defaultValue={g.name} placeholder="Name" />
                    <Input name="costCentreCode" defaultValue={g.costCentreCode ?? ''} placeholder="Cost centre code (optional)" />
                    <select name="parentId" defaultValue={g.parentId ?? ''} className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm">
                      <option value="">No parent</option>
                      {groups.filter((p) => p.id !== g.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <Button type="submit" size="sm">Save</Button>
                  </form>
                </details>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Card className="mt-6">
        <CardHeader><CardTitle>Add project group</CardTitle></CardHeader>
        <CardContent>
          <form action={createProjectGroupAction} className="space-y-2">
            <div className="space-y-2"><Label htmlFor="name">Name</Label><Input id="name" name="name" required /></div>
            <div className="space-y-2"><Label htmlFor="costCentreCode">Cost centre code (optional)</Label><Input id="costCentreCode" name="costCentreCode" /></div>
            <div className="space-y-2">
              <Label htmlFor="parentId">Parent (optional)</Label>
              <select id="parentId" name="parentId" defaultValue="" className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm">
                <option value="">No parent</option>
                {groups.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <Button type="submit">Add project group</Button>
          </form>
        </CardContent>
      </Card>
    </AppShell>
  );
}
