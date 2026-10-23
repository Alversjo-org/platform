import type { Area } from '@/db/schema';
import { areaColor } from './area-color';

export type MapAreaData = {
  id: string;
  name: string;
  description: string;
  capacity: number | null;
  bookable: boolean;
  color: string;
  cells: Array<{ col: number; row: number }>;
  bookings: Array<{ eventTitle: string; eventSlug: string; from: string; to: string }>;
};

export function buildMapAreaData(
  areasWithCells: Array<{ area: Area; cells: Array<{ col: number; row: number }> }>,
  bookings: Array<{ areaId: string; eventSlug: string; eventTitle: string; from: Date; to: Date }>,
): MapAreaData[] {
  const bookingsByAreaId = new Map<string, Array<{ eventTitle: string; eventSlug: string; from: string; to: string }>>();
  for (const b of bookings) {
    const list = bookingsByAreaId.get(b.areaId) ?? [];
    list.push({ eventTitle: b.eventTitle, eventSlug: b.eventSlug, from: b.from.toISOString().slice(0, 10), to: b.to.toISOString().slice(0, 10) });
    bookingsByAreaId.set(b.areaId, list);
  }

  return areasWithCells
    .filter(({ cells }) => cells.length > 0)
    .map(({ area, cells }) => ({
      id: area.id,
      name: area.name,
      description: area.description,
      capacity: area.capacity,
      bookable: area.bookable,
      color: areaColor(area.id),
      cells,
      bookings: bookingsByAreaId.get(area.id) ?? [],
    }));
}
