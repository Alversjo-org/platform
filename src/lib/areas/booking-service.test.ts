import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import { bookEventArea, listEventAreas, removeEventArea } from './booking-service';

describe('booking-service', () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    await db.insert(schema.area).values({ id: 'kitchen', name: 'Kitchen' });
    await db.insert(schema.project).values([
      { id: 'e1', slug: 'e1', title: 'Breakfast', kind: 'event', ownerUserId: 'u1' },
      { id: 'e2', slug: 'e2', title: 'Lunch', kind: 'event', ownerUserId: 'u1' },
    ]);
  });

  it('books an area with no existing bookings and reports no overlaps', async () => {
    const { booking, overlaps } = await bookEventArea(db, { eventProjectId: 'e1', areaId: 'kitchen', from: new Date('2027-06-20T08:00:00Z'), to: new Date('2027-06-20T09:00:00Z'), setupNote: null });
    expect(booking.areaId).toBe('kitchen');
    expect(overlaps).toEqual([]);
  });

  it('still books an overlapping time but reports the conflicting event', async () => {
    await bookEventArea(db, { eventProjectId: 'e1', areaId: 'kitchen', from: new Date('2027-06-20T08:00:00Z'), to: new Date('2027-06-20T10:00:00Z'), setupNote: null });
    const { booking, overlaps } = await bookEventArea(db, { eventProjectId: 'e2', areaId: 'kitchen', from: new Date('2027-06-20T09:00:00Z'), to: new Date('2027-06-20T11:00:00Z'), setupNote: null });
    expect(booking.eventProjectId).toBe('e2'); // saved despite the conflict
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]).toMatchObject({ eventProjectId: 'e1', eventTitle: 'Breakfast' });
  });

  it('does not treat back-to-back (non-overlapping) bookings as a conflict', async () => {
    await bookEventArea(db, { eventProjectId: 'e1', areaId: 'kitchen', from: new Date('2027-06-20T08:00:00Z'), to: new Date('2027-06-20T09:00:00Z'), setupNote: null });
    const { overlaps } = await bookEventArea(db, { eventProjectId: 'e2', areaId: 'kitchen', from: new Date('2027-06-20T09:00:00Z'), to: new Date('2027-06-20T10:00:00Z'), setupNote: null });
    expect(overlaps).toEqual([]);
  });

  it('lists and removes bookings for an event', async () => {
    const { booking } = await bookEventArea(db, { eventProjectId: 'e1', areaId: 'kitchen', from: new Date(), to: new Date(), setupNote: null });
    expect(await listEventAreas(db, 'e1')).toHaveLength(1);
    await removeEventArea(db, { eventAreaId: booking.id, eventProjectId: 'e1' });
    expect(await listEventAreas(db, 'e1')).toHaveLength(0);
  });

  it('does not remove a booking that belongs to a different event', async () => {
    const { booking } = await bookEventArea(db, { eventProjectId: 'e1', areaId: 'kitchen', from: new Date(), to: new Date(), setupNote: null });
    await removeEventArea(db, { eventAreaId: booking.id, eventProjectId: 'e2' }); // wrong event, should be a no-op
    expect(await listEventAreas(db, 'e1')).toHaveLength(1);
  });
});
