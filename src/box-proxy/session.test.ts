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
});
