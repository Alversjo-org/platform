import { describe, expect, it, vi } from 'vitest';
import { createDb, schema, type Db } from '@/db';

let db: Db;
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: async () => db }));

import { GET } from './route';

const feed = (token: string) => GET(new Request(`http://localhost/events/members.ics?token=${token}`));

describe('GET /events/members.ics', () => {
  it('serves the feed to a paid member and nothing once the membership has lapsed', async () => {
    db = await createDb('pglite://memory');
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await db.insert(schema.user).values([
      { id: 'paid', email: 'paid@example.org', isActiveMember: true, membershipExpiresAt: future, icalToken: 'paid-token' },
      { id: 'lapsed', email: 'lapsed@example.org', isActiveMember: false, icalToken: 'lapsed-token' },
    ]);
    expect((await feed('paid-token')).status).toBe(200);
    expect((await feed('lapsed-token')).status).toBe(404);
  });
});
