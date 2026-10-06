import { beforeEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { createDb, type Db } from '@/db';

let db: Db;
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: async () => db }));

import { POST } from './route';

describe('POST /api/webhooks/stripe', () => {
  const secret = 'whsec_test_secret';

  beforeEach(async () => {
    db = await createDb('pglite://memory');
    process.env.STRIPE_API_KEY = 'sk_test_dummy';
    process.env.STRIPE_WEBHOOK_SECRET = secret;
  });

  function signedRequest(payloadObj: unknown): Request {
    const payload = JSON.stringify(payloadObj);
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    return new Request('http://localhost/api/webhooks/stripe', {
      method: 'POST', body: payload, headers: { 'stripe-signature': header },
    });
  }

  it('rejects a request with a bad signature', async () => {
    const req = new Request('http://localhost/api/webhooks/stripe', {
      method: 'POST', body: '{}', headers: { 'stripe-signature': 'bad' },
    });
    expect((await POST(req)).status).toBe(400);
  });

  it('rejects a request with no signature header at all', async () => {
    const req = new Request('http://localhost/api/webhooks/stripe', { method: 'POST', body: '{}' });
    expect((await POST(req)).status).toBe(400);
  });

  it('accepts a correctly signed event it does not otherwise act on', async () => {
    const req = signedRequest({ id: 'evt_1', type: 'payment_intent.succeeded', data: { object: {} } });
    expect((await POST(req)).status).toBe(200);
  });
});
