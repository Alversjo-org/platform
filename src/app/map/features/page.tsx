import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getDb } from '@/db';
import { FEATURE_KINDS, MAP_LAYERS } from '@/lib/map/feature-kinds';
import { listMapFeatures, toMapFeatureData } from '@/lib/map/features';
import { requireMapper } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function MapFeaturesPage() {
  const user = await requireMapper();
  const features = toMapFeatureData(await listMapFeatures(await getDb()));
  return (
    <AppShell user={user}>
      <h1 className="mb-2 text-xl font-semibold">Map features</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Places, borders, paths and zones shown on the <Link href="/map" className="underline">map</Link>. Bookable sections are
        edited under <Link href="/areas" className="underline">Areas</Link>.
      </p>
      <div className="mb-6 flex flex-wrap gap-2">
        <Button nativeButton={false} render={<Link href="/map/features/new?shape=point" />}>Add a point</Button>
        <Button variant="outline" nativeButton={false} render={<Link href="/map/features/new?shape=line" />}>Add a line</Button>
        <Button variant="outline" nativeButton={false} render={<Link href="/map/features/new?shape=polygon" />}>Add a shape</Button>
      </div>
      {MAP_LAYERS.map((layer) => {
        const rows = features.filter((f) => FEATURE_KINDS[f.kind].layer === layer.id);
        if (rows.length === 0) return null;
        return (
          <section key={layer.id} className="mb-6">
            <h2 className="mb-2 font-medium">{layer.label} <span className="text-sm text-muted-foreground">({rows.length})</span></h2>
            <Table>
              <TableHeader>
                <TableRow><TableHead>Name</TableHead><TableHead>Kind</TableHead><TableHead /></TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell>{f.name || <span className="text-muted-foreground">(no name)</span>}</TableCell>
                    <TableCell>{FEATURE_KINDS[f.kind].label}</TableCell>
                    <TableCell className="text-right"><Link href={`/map/features/${encodeURIComponent(f.id)}`} className="text-sm underline">Edit</Link></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        );
      })}
    </AppShell>
  );
}
