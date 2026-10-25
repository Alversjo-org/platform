import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, schema, type Db } from '@/db';

let db: Db;
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: async () => db }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    prices: {
      list: async ({ lookup_keys }: { lookup_keys: string[] }) =>
        ({ data: lookup_keys[0] === 'membership_yearly' ? [{ id: 'price_yearly' }] : [{ id: 'price_monthly' }] }),
    },
    subscriptions: {
      list: async ({ price }: { price: string }) => ({
        data: price === 'price_yearly'
          ? [{ id: 'sub_1', status: 'active', items: { data: [] }, customer: { id: 'cus_1', email: 'synced@example.org', deleted: false } }]
          : [],
        has_more: false,
      }),
    },
  }),
}));

import { POST } from './route';

describe('POST /api/cron/stripe-sync', () => {
  const secret = 'cron_test_secret';

  beforeEach(async () => {
    db = await createDb('pglite://memory');
    process.env.CRON_SECRET = secret;
  });

  function request(authHeader: string | undefined): Request {
    return new Request('http://localhost/api/cron/stripe-sync', {
      method: 'POST',
      headers: authHeader === undefined ? {} : { authorization: authHeader },
    });
  }

  it('rejects a request with no Authorization header', async () => {
    expect((await POST(request(undefined))).status).toBe(401);
  });

  it('rejects a request with the wrong secret', async () => {
    expect((await POST(request('Bearer wrong'))).status).toBe(401);
  });

  it('runs the sync and creates a member for a correctly authenticated request', async () => {
    const res = await POST(request(`Bearer ${secret}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [{ email: 'synced@example.org', status: 'created' }] });
    const [u] = await db.select().from(schema.user).where(eq(schema.user.email, 'synced@example.org'));
    expect(u).toMatchObject({ isActiveMember: true, stripeCustomerId: 'cus_1' });
  });
});
