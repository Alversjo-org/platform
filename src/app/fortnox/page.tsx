import { AppShell } from '@/components/app-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb, schema } from '@/db';
import { getConnection } from '@/lib/fortnox/connection-service';
import { requireTreasurer } from '@/lib/session';
import { connectAction, disconnectAction, runFirstImportAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function FortnoxPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const treasurer = await requireTreasurer();
  const db = await getDb();
  const connection = await getConnection(db);
  const syncState = await db.select().from(schema.fxSyncState);
  const { error } = await searchParams;

  return (
    <AppShell user={treasurer}>
      <h1 className="mb-4 text-xl font-semibold">Fortnox connection</h1>
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>Fortnox error: {error}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Status: {connection?.status ?? 'disconnected'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {connection?.status === 'needs_reauth' && (
            <p className="text-sm text-muted-foreground">Last error: {connection.lastRefreshError}</p>
          )}
          <form action={connectAction}>
            <Button type="submit">{connection?.status === 'connected' ? 'Reconnect' : 'Connect'}</Button>
          </form>
          {connection?.status === 'connected' && (
            <>
              <form action={runFirstImportAction}>
                <Button type="submit" variant="outline">Run first import</Button>
              </form>
              <form action={disconnectAction}>
                <Button type="submit" variant="outline">Disconnect</Button>
              </form>
              <ul className="text-sm text-muted-foreground">
                {syncState.map((s) => (
                  <li key={s.topic}>{s.topic}: {s.lastFullSyncAt ? s.lastFullSyncAt.toISOString() : 'never'}</li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
