import { describe, expect, it } from 'vitest';
import type { Area } from '@/db/schema';
import { buildMapAreaData } from './view-model';

const area = (id: string, over: Partial<Area> = {}): Area =>
  ({ id, name: id, description: '', capacity: null, bookable: true, ...over }) as Area;

describe('buildMapAreaData', () => {
  it('excludes an area with zero grid cells', () => {
    const result = buildMapAreaData([{ area: area('empty'), cells: [] }], []);
    expect(result).toEqual([]);
  });

  it('includes an area with cells, attaching its formatted upcoming bookings', () => {
    const result = buildMapAreaData(
      [{ area: area('f'), cells: [{ col: 1, row: 1 }] }],
      [{ areaId: 'f', eventSlug: 'harvest', eventTitle: 'Harvest', from: new Date('2027-09-01T10:00:00Z'), to: new Date('2027-09-01T12:00:00Z') }],
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'f', bookings: [{ eventTitle: 'Harvest', eventSlug: 'harvest', from: '2027-09-01', to: '2027-09-01' }] });
  });
});
