import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import { bookEventAreas } from './booking-service';
import { listEventAreas } from './booking-service';

describe('bookEventAreas', () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    await db.insert(schema.area).values([{ id: 'kitchen', name: 'Kitchen' }, { id: 'hall', name: 'Hall' }]);
    await db.insert(schema.project).values([
      { id: 'e1', slug: 'e1', title: 'Breakfast', kind: 'event', status: 'published', ownerUserId: 'u1' },
      { id: 'e2', slug: 'e2', title: 'Lunch', kind: 'event', status: 'published', ownerUserId: 'u1' },
    ]);
  });

  const span = { from: new Date('2027-06-20T08:00:00Z'), to: new Date('2027-06-20T09:00:00Z') };

  it('books every selected area with the same from/to span and no setup note', async () => {
    const { bookings } = await bookEventAreas(db, { eventProjectId: 'e1', areaIds: ['kitchen', 'hall'], ...span });
    expect(bookings).toHaveLength(2);
    expect(bookings.map((b) => b.areaId).sort()).toEqual(['hall', 'kitchen']);
    for (const b of bookings) {
      expect(b.from).toEqual(span.from);
      expect(b.to).toEqual(span.to);
      expect(b.setupNote).toBeNull();
    }
    expect(await listEventAreas(db, 'e1')).toHaveLength(2);
  });

  it('books nothing and returns empty results when no areas are selected', async () => {
    const { bookings, overlaps } = await bookEventAreas(db, { eventProjectId: 'e1', areaIds: [], ...span });
    expect(bookings).toEqual([]);
    expect(overlaps).toEqual([]);
  });

  it('reports overlaps per booked area against other events', async () => {
    await bookEventAreas(db, { eventProjectId: 'e2', areaIds: ['kitchen'], ...span });
    const { overlaps } = await bookEventAreas(db, { eventProjectId: 'e1', areaIds: ['kitchen', 'hall'], ...span });
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]).toMatchObject({ eventProjectId: 'e2', eventTitle: 'Lunch' });
  });
});
