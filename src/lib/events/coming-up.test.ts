import { describe, expect, it } from 'vitest';
import { createDb, schema } from '@/db';
import { listComingUp } from './coming-up';

describe('listComingUp', () => {
  it('lists the next published events with their areas and going seats, soonest first', async () => {
    const db = await createDb('pglite://memory');
    const now = new Date('2026-11-03T12:00:00Z');
    await db.insert(schema.user).values([{ id: 'u1', email: 'a@example.org' }, { id: 'u2', email: 'b@example.org' }]);
    const rows = [['later', 'published', '2026-11-20T18:00:00Z'], ['soon', 'published', '2026-11-14T09:00:00Z'], ['past', 'published', '2026-10-01T09:00:00Z'], ['draft', 'draft', '2026-11-10T09:00:00Z']] as const;
    await db.insert(schema.project).values(rows.map(([id, status]) => ({ id, slug: id, title: id, summary: '', body: '', kind: 'event' as const, status, visibility: 'members' as const, ownerUserId: 'u1' })));
    await db.insert(schema.eventDetails).values(rows.map(([id, , startsAt]) => ({ projectId: id, startsAt: new Date(startsAt), endsAt: new Date(new Date(startsAt).getTime() + 3600_000), hasCapacityLimit: false })));
    await db.insert(schema.area).values({ id: 'a1', name: 'Gate-Keepers' });
    await db.insert(schema.eventArea).values({ id: 'ea1', eventProjectId: 'soon', areaId: 'a1', from: new Date('2026-11-14T09:00:00Z'), to: new Date('2026-11-14T12:00:00Z') });
    await db.insert(schema.eventSignup).values([
      { eventProjectId: 'soon', userId: 'u1', status: 'going', seats: 2 },
      { eventProjectId: 'soon', userId: 'u2', status: 'waitlist', seats: 1 },
    ]);

    const list = await listComingUp(db, now);
    expect(list.map((e) => e.slug)).toEqual(['soon', 'later']);
    expect(list[0]).toMatchObject({ areas: ['Gate-Keepers'], going: 2 });
    expect(list[1]).toMatchObject({ areas: [], going: 0 });
  });
});
