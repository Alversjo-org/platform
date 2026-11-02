import { AppShell } from '@/components/app-shell';
import { MapView } from '@/components/map/map-view';
import { getDb } from '@/db';
import { listUpcomingAreaBookings } from '@/lib/areas/booking-service';
import { listMappedAreas } from '@/lib/map/area-geometry';
import { listMapFeatures, toMapFeatureData } from '@/lib/map/features';
import { buildMapAreaData } from '@/lib/map/view-model';
import { hasAnyRole, MAPPER_ROLES, requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function MapPage() {
  const user = await requireUser();
  const db = await getDb();
  const [mapped, features, bookings] = await Promise.all([
    listMappedAreas(db),
    listMapFeatures(db),
    listUpcomingAreaBookings(db, new Date()),
  ]);
  const areas = buildMapAreaData(mapped, bookings);
  return (
    <AppShell user={user}>
      <h1 className="mb-4 text-xl font-semibold">Map</h1>
      <MapView areas={areas} features={toMapFeatureData(features)} canEditFeatures={hasAnyRole(user, MAPPER_ROLES)} />
    </AppShell>
  );
}
