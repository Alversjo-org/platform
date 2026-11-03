import type { Area } from '@/db/schema';
import { utcToStockholmWallClock } from '@/lib/timezone';
import { areaColor } from './area-color';
import { hectares, labelPoint, type AreaGeometry } from './geometry';

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
  /** Size of the outline, rounded to 0.1 ha. */
  hectares: number;
  /** `from`/`to` are Stockholm wall clock ("YYYY-MM-DDTHH:mm"); `startsAt` is the UTC instant. */
  bookings: Array<{ eventTitle: string; eventSlug: string; from: string; to: string; startsAt: string }>;
};

export function buildMapAreaData(
  areas: Area[],
  bookings: Array<{ areaId: string; eventSlug: string; eventTitle: string; from: Date; to: Date }>,
): MapAreaData[] {
  const bookingsByAreaId = new Map<string, MapAreaData['bookings']>();
  for (const b of bookings) {
    const list = bookingsByAreaId.get(b.areaId) ?? [];
    list.push({ eventTitle: b.eventTitle, eventSlug: b.eventSlug, from: utcToStockholmWallClock(b.from), to: utcToStockholmWallClock(b.to), startsAt: b.from.toISOString() });
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
      hectares: Math.round(hectares(area.geometry) * 10) / 10,
      bookings: bookingsByAreaId.get(area.id) ?? [],
    }];
  });
}
