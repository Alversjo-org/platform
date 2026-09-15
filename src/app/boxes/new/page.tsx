import { AppShell } from '@/components/app-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { requireAdmin } from '@/lib/session';
import { createBoxAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function NewBoxPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireAdmin();
  const { error } = await searchParams;
  return (
    <AppShell user={user}>
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>New box</CardTitle>
          <CardDescription>Creates a Fly machine with a 10 GB volume. Takes about a minute.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createBoxAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required placeholder="viktor-map-experiments" />
            </div>
            <fieldset className="space-y-2">
              <Label>Profile</Label>
              <RadioGroup name="profile" defaultValue="contributor" className="flex gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="contributor" id="profile-contributor" />
                  <Label htmlFor="profile-contributor">contributor (PRs only)</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="admin" id="profile-admin" />
                  <Label htmlFor="profile-admin">admin (all tokens)</Label>
                </div>
              </RadioGroup>
            </fieldset>
            <Button type="submit">Create</Button>
          </form>
        </CardContent>
      </Card>
    </AppShell>
  );
}
