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
    expect(result[0]).toMatchObject({ id: 'f', bookings: [{ eventTitle: 'Harvest', eventSlug: 'harvest', from: '2027-09-01T12:00', to: '2027-09-01T14:00' }] });
  });

  it('formats booking times in Europe/Stockholm, not UTC — a late-UTC booking lands on the next Stockholm day', () => {
    const result = buildMapAreaData(
      [{ area: area('f'), cells: [{ col: 1, row: 1 }] }],
      [{ areaId: 'f', eventSlug: 'bonfire', eventTitle: 'Bonfire', from: new Date('2027-06-19T23:00:00Z'), to: new Date('2027-06-20T00:30:00Z') }],
    );
    // Stockholm is UTC+2 in June (CEST): 23:00 UTC on the 19th is 01:00 on the 20th.
    expect(result[0].bookings[0]).toMatchObject({ from: '2027-06-20T01:00', to: '2027-06-20T02:30' });
  });
});
