import { AppShell } from '@/components/app-shell';
import { MapView } from '@/components/map/map-view';
import { getDb } from '@/db';
import { listAreasWithCells } from '@/lib/map/area-cells';
import { listUpcomingAreaBookings } from '@/lib/areas/booking-service';
import { buildMapAreaData } from '@/lib/map/view-model';
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function MapPage() {
  const user = await requireUser();
  const db = await getDb();
  const [areasWithCells, bookings] = await Promise.all([
    listAreasWithCells(db),
    listUpcomingAreaBookings(db, new Date()),
  ]);
  const areas = buildMapAreaData(areasWithCells, bookings);
  return (
    <AppShell user={user}>
      <h1 className="mb-4 text-xl font-semibold">Map</h1>
      <MapView areas={areas} />
    </AppShell>
  );
}
