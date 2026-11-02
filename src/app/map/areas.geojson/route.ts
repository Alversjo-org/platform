import { getDb } from '@/db';
import { listMappedAreas } from '@/lib/map/area-geometry';
import { areasToFeatureCollection } from '@/lib/map/geojson';
import { getSessionUser } from '@/lib/session';

/** Every mapped area as a GeoJSON FeatureCollection (RFC 7946), for QGIS, Google Earth, other maps. Members only. */
export async function GET() {
  if (!(await getSessionUser())) return new Response('Log in to download map data.', { status: 401 });
  const fc = areasToFeatureCollection(await listMappedAreas(await getDb()));
  return new Response(JSON.stringify(fc), {
    headers: {
      'Content-Type': 'application/geo+json; charset=utf-8',
      'Content-Disposition': 'inline; filename="alversjo-areas.geojson"',
      'Cache-Control': 'private, no-store',
    },
  });
}
