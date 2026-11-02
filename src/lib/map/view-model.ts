import type { Area } from '@/db/schema';
import { utcToStockholmWallClock } from '@/lib/timezone';
import { areaColor } from './area-color';
import { labelPoint, type AreaGeometry } from './geometry';

export type MapAreaData = {
  id: string;
  name: string;
  description: string;
  capacity: number | null;
  bookable: boolean;
  color: string;
  geometry: AreaGeometry;
  /** Leaflet [lat, lng] for the name label; always inside the shape. */
  label: [number, number];
  bookings: Array<{ eventTitle: string; eventSlug: string; from: string; to: string }>;
};

export function buildMapAreaData(
  areas: Area[],
  bookings: Array<{ areaId: string; eventSlug: string; eventTitle: string; from: Date; to: Date }>,
): MapAreaData[] {
  const bookingsByAreaId = new Map<string, Array<{ eventTitle: string; eventSlug: string; from: string; to: string }>>();
  for (const b of bookings) {
    const list = bookingsByAreaId.get(b.areaId) ?? [];
    list.push({ eventTitle: b.eventTitle, eventSlug: b.eventSlug, from: utcToStockholmWallClock(b.from), to: utcToStockholmWallClock(b.to) });
    bookingsByAreaId.set(b.areaId, list);
  }

  // An area without an outline (e.g. "Kitchen") is still bookable, just not drawn.
  return areas.flatMap((area) => {
    if (!area.geometry) return [];
    return [{
      id: area.id,
      name: area.name,
      description: area.description,
      capacity: area.capacity,
      bookable: area.bookable,
      color: areaColor(area.id),
      geometry: area.geometry,
      label: labelPoint(area.geometry),
      bookings: bookingsByAreaId.get(area.id) ?? [],
    }];
  });
}
