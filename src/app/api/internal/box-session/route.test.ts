import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import { buildAuth, type Auth } from '@/lib/auth';

let db: Db;
let auth: Auth;
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: async () => db }));
vi.mock('@/lib/auth', async (orig) => ({ ...(await orig<typeof import('@/lib/auth')>()), getAuth: async () => auth }));

import { POST } from './route';

async function cookieFor(email: string) {
  const sent: string[] = [];
  const a = buildAuth(db, { sendOtp: async ({ otp }) => void sent.push(otp) });
  auth = a;
  await a.api.sendVerificationOTP({ body: { email, type: 'sign-in' } });
  const res = await a.api.signInEmailOTP({ body: { email, otp: sent[0] }, asResponse: true });
  return res.headers.get('set-cookie')!.split(';')[0];
}

function call(body: unknown, secret = 'internal') {
  return POST(new Request('http://localhost/api/internal/box-session', { method: 'POST', headers: { 'x-internal-secret': secret, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
}

describe('POST /api/internal/box-session', () => {
  beforeEach(async () => {
    process.env.BETTER_AUTH_SECRET = 'test-secret-test-secret-test-secret';
    process.env.INTERNAL_SECRET = 'internal';
    process.env.ADMIN_EMAILS = 'admin@example.org';
    db = await createDb('pglite://memory');
  });

  it('rejects calls without the internal secret', async () => {
    const res = await call({ host: 'x.boxes.localhost', cookie: '' }, 'wrong');
    expect(res.status).toBe(403);
  });

  it('unauthenticated without a session cookie', async () => {
    auth = buildAuth(db);
    const res = await call({ host: 'x.boxes.localhost', cookie: '' });
    expect(await res.json()).toEqual({ status: 'unauthenticated' });
  });

  it('ok with a token for an admin on an existing box', async () => {
    const cookie = await cookieFor('admin@example.org');
    const [u] = await db.select().from(schema.user);
    await db.insert(schema.boxes).values({ id: 'abc', name: 'b', profile: 'admin', jwtSecret: 's', ownerUserId: u.id, flyMachineId: 'm1', status: 'started' });
    const body = await (await call({ host: 'abc.boxes.localhost', cookie })).json();
    expect(body).toMatchObject({ status: 'ok', boxId: 'abc', machineId: 'm1', canStart: true });
    expect(typeof body.token).toBe('string');
  });

  it('forbidden for a member without access, not_found for unknown box', async () => {
    const cookie = await cookieFor('member@example.org');
    const [u] = await db.select().from(schema.user);
    await db.insert(schema.boxes).values({ id: 'abc', name: 'b', profile: 'admin', jwtSecret: 's', ownerUserId: u.id, flyMachineId: 'm1' });
    expect(await (await call({ host: 'abc.boxes.localhost', cookie })).json()).toEqual({ status: 'forbidden' });
    expect(await (await call({ host: 'zzz.boxes.localhost', cookie })).json()).toEqual({ status: 'not_found' });
  });
});
