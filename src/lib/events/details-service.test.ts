import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import { getEventDetails, InvalidCapacityError, upsertEventDetails } from './details-service';

describe('upsertEventDetails', () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    await db.insert(schema.project).values({ id: 'p1', slug: 'p1', title: 'T', kind: 'event', ownerUserId: 'u1' });
  });

  const base = { projectId: 'p1', startsAt: new Date('2027-06-20T10:00:00Z'), endsAt: new Date('2027-06-20T18:00:00Z'), signupOpensAt: null, signupClosesAt: null, priceSek: 0, priceNote: null, contactNote: null, showSignupsToParticipants: false };

  it('inserts, then updates the same row on a second call', async () => {
    const first = await upsertEventDetails(db, { ...base, hasCapacityLimit: true, capacity: 40 });
    expect(first.capacity).toBe(40);
    const second = await upsertEventDetails(db, { ...base, hasCapacityLimit: true, capacity: 50 });
    expect(second.capacity).toBe(50);
    expect(await getEventDetails(db, 'p1')).toMatchObject({ capacity: 50 });
  });

  it('accepts hasCapacityLimit=false with capacity=null', async () => {
    const row = await upsertEventDetails(db, { ...base, hasCapacityLimit: false, capacity: null });
    expect(row.capacity).toBeNull();
  });

  it('rejects hasCapacityLimit=true with capacity=null', async () => {
    await expect(upsertEventDetails(db, { ...base, hasCapacityLimit: true, capacity: null })).rejects.toBeInstanceOf(InvalidCapacityError);
  });

  it('rejects hasCapacityLimit=false with a non-null capacity', async () => {
    await expect(upsertEventDetails(db, { ...base, hasCapacityLimit: false, capacity: 10 })).rejects.toBeInstanceOf(InvalidCapacityError);
  });

  it('rejects hasCapacityLimit=true with capacity=0 (an empty form field, not a real zero-seat event)', async () => {
    await expect(upsertEventDetails(db, { ...base, hasCapacityLimit: true, capacity: 0 })).rejects.toBeInstanceOf(InvalidCapacityError);
  });

  it('rejects hasCapacityLimit=true with a negative or non-finite capacity', async () => {
    await expect(upsertEventDetails(db, { ...base, hasCapacityLimit: true, capacity: -1 })).rejects.toBeInstanceOf(InvalidCapacityError);
    await expect(upsertEventDetails(db, { ...base, hasCapacityLimit: true, capacity: NaN })).rejects.toBeInstanceOf(InvalidCapacityError);
  });
});
