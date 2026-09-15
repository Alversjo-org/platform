import { describe, expect, it } from 'vitest';
import { resolveBoxSession } from './session';

describe('resolveBoxSession', () => {
  it('posts host + cookie with the secret and caches ok results for the same cookie', async () => {
    let n = 0;
    const fetchImpl: typeof fetch = async (url, init) => {
      n++;
      expect(String(url)).toBe('http://127.0.0.1:3000/api/internal/box-session');
      expect(new Headers(init?.headers).get('x-internal-secret')).toBe('s');
      expect(JSON.parse(String(init?.body))).toEqual({ host: 'abc.boxes.localhost', cookie: n === 1 ? 'c=1' : 'c=2' });
      return Response.json({ status: 'ok', boxId: 'abc', machineId: 'm1', token: 't', canStart: true });
    };
    const opts = { host: 'abc.boxes.localhost', cookie: 'c=1', internalUrl: 'http://127.0.0.1:3000', secret: 's', fetch: fetchImpl };
    expect((await resolveBoxSession(opts)).status).toBe('ok');
    expect((await resolveBoxSession(opts)).status).toBe('ok');
    expect(n).toBe(1);
    expect((await resolveBoxSession({ ...opts, cookie: 'c=2' })).status).toBe('ok');
    expect(n).toBe(2);
  });

  it('does not cache non-ok results', async () => {
    let n = 0;
    const fetchImpl: typeof fetch = async () => { n++; return Response.json({ status: 'unauthenticated' }); };
    const opts = { host: 'x.boxes.localhost', cookie: undefined, internalUrl: 'http://127.0.0.1:3000', secret: 's', fetch: fetchImpl };
    await resolveBoxSession(opts);
    await resolveBoxSession(opts);
    expect(n).toBe(2);
  });

  it('returns unavailable when the internal route responds non-2xx', async () => {
    const fetchImpl: typeof fetch = async () => new Response('boom', { status: 500 });
    const opts = { host: 'unavailable-1.boxes.localhost', cookie: 'c', internalUrl: 'http://127.0.0.1:3000', secret: 's', fetch: fetchImpl };
    expect(await resolveBoxSession(opts)).toEqual({ status: 'unavailable' });
  });

  it('returns unavailable when the internal route response is not JSON', async () => {
    const fetchImpl: typeof fetch = async () => new Response('not json', { status: 200 });
    const opts = { host: 'unavailable-2.boxes.localhost', cookie: 'c', internalUrl: 'http://127.0.0.1:3000', secret: 's', fetch: fetchImpl };
    expect(await resolveBoxSession(opts)).toEqual({ status: 'unavailable' });
  });

  it('returns unavailable when the fetch itself throws', async () => {
    const fetchImpl: typeof fetch = async () => { throw new Error('network down'); };
    const opts = { host: 'unavailable-3.boxes.localhost', cookie: 'c', internalUrl: 'http://127.0.0.1:3000', secret: 's', fetch: fetchImpl };
    expect(await resolveBoxSession(opts)).toEqual({ status: 'unavailable' });
  });

  it('bounds the cache at 1000 entries by evicting the oldest', async () => {
    let n = 0;
    const fetchImpl: typeof fetch = async () => { n++; return Response.json({ status: 'ok', boxId: 'x', machineId: 'm', token: 't', canStart: false }); };
    const base = { host: 'bound.boxes.localhost', internalUrl: 'http://127.0.0.1:3000', secret: 's', fetch: fetchImpl };
    for (let i = 1; i <= 1001; i++) {
      await resolveBoxSession({ ...base, cookie: `c${i}` });
    }
    expect(n).toBe(1001);
    // The oldest entry must have been evicted once the cache exceeded 1000 entries.
    await resolveBoxSession({ ...base, cookie: 'c1' });
    expect(n).toBe(1002);
    // A recently-inserted entry must still be cached.
    await resolveBoxSession({ ...base, cookie: 'c1001' });
    expect(n).toBe(1002);
  });
});
