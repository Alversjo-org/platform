import { notFound } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { AreaShapeEditor } from '@/components/map/area-shape-editor';
import { getDb } from '@/db';
import { getArea } from '@/lib/areas/service';
import { listMappedAreas } from '@/lib/map/area-geometry';
import { requireMapper } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function AreaShapePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireMapper();
  const { id } = await params;
  const db = await getDb();
  const [area, mapped] = await Promise.all([getArea(db, id), listMappedAreas(db)]);
  if (!area) notFound();
  const others = mapped
    .filter((a) => a.id !== id && a.geometry)
    .map((a) => ({ id: a.id, name: a.name, geometry: a.geometry! }));
  return (
    <AppShell user={user}>
      <h1 className="mb-4 text-xl font-semibold">Edit shape: {area.name}</h1>
      <AreaShapeEditor areaId={id} initial={area.geometry} others={others} />
    </AppShell>
  );
}
