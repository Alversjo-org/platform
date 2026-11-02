import { getDb } from '@/db';
import { FEATURE_KINDS } from '@/lib/map/feature-kinds';
import { listMapFeatures, toMapFeatureData } from '@/lib/map/features';
import { getSessionUser } from '@/lib/session';

/** Every map feature (places, borders, paths, zones) as a GeoJSON FeatureCollection. Members only. */
export async function GET() {
  if (!(await getSessionUser())) return new Response('Log in to download map data.', { status: 401 });
  const features = toMapFeatureData(await listMapFeatures(await getDb()));
  const fc = {
    type: 'FeatureCollection',
    features: features.map((f) => ({
      type: 'Feature',
      id: f.id,
      geometry: f.geometry,
      properties: { ...f.properties, id: f.id, kind: f.kind, layer: FEATURE_KINDS[f.kind].layer, name: f.name, description: f.description },
    })),
  };
  return new Response(JSON.stringify(fc), {
    headers: {
      'Content-Type': 'application/geo+json; charset=utf-8',
      'Content-Disposition': 'inline; filename="alversjo-features.geojson"',
      'Cache-Control': 'private, no-store',
    },
  });
}
