import { notFound } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { CellPicker } from '@/components/map/cell-picker';
import { getDb } from '@/db';
import { listAreaCells } from '@/lib/map/area-cells';
import { getArea } from '@/lib/areas/service';
import { requireMapper } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function AreaCellsPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireMapper();
  const { id } = await params;
  const db = await getDb();
  const area = await getArea(db, id);
  if (!area) notFound();
  const cells = await listAreaCells(db, id);
  return (
    <AppShell user={admin}>
      <h1 className="mb-4 text-xl font-semibold">Edit cells: {area.name}</h1>
      <CellPicker areaId={id} initialCells={cells} />
    </AppShell>
  );
}
