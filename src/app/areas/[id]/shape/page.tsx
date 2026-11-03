import { notFound } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { AreaShapeEditor } from '@/components/map/area-shape-editor';
import { getDb } from '@/db';
import { getArea } from '@/lib/areas/service';
import { listMappedAreas } from '@/lib/map/area-geometry';
import { listMapFeatures, toMapFeatureData } from '@/lib/map/features';
import { requireMapper } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function AreaShapePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireMapper();
  const { id } = await params;
  const db = await getDb();
  const [area, mapped, features] = await Promise.all([getArea(db, id), listMappedAreas(db), listMapFeatures(db)]);
  if (!area) notFound();
  const others = mapped
    .filter((a) => a.id !== id && a.geometry)
    .map((a) => ({ id: a.id, name: a.name, geometry: a.geometry! }));
  return (
    <AppShell user={user} theme="dark">
      <AreaShapeEditor areaId={id} areaName={area.name} initial={area.geometry} others={others} features={toMapFeatureData(features)} />
    </AppShell>
  );
}
