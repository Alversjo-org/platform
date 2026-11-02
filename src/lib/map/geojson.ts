import type { Feature, FeatureCollection } from 'geojson';
import type { Area } from '@/db/schema';
import { areaColor } from './area-color';
import type { AreaGeometry } from './geometry';

export type AreaFeatureProperties = {
  id: string;
  name: string;
  description: string;
  capacity: number | null;
  bookable: boolean;
  /** simplestyle-spec, understood by geojson.io, GitHub, uMap and others. */
  fill: string;
  stroke: string;
};

/** Areas as a GeoJSON FeatureCollection. Areas without an outline are left out. */
export function areasToFeatureCollection(areas: Area[]): FeatureCollection<AreaGeometry, AreaFeatureProperties> {
  const features = areas.flatMap((a): Array<Feature<AreaGeometry, AreaFeatureProperties>> => {
    if (!a.geometry) return [];
    const color = areaColor(a.id);
    return [{
      type: 'Feature',
      id: a.id,
      geometry: a.geometry,
      properties: { id: a.id, name: a.name, description: a.description, capacity: a.capacity, bookable: a.bookable, fill: color, stroke: color },
    }];
  });
  return { type: 'FeatureCollection', features };
}
