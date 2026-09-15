import { describe, expect, it } from 'vitest';
import { FlyClient, FlyError } from './fly';

type Call = { method: string; url: string; body?: unknown; auth?: string | null };

function fakeFetch(responder: (call: Call) => { status: number; json?: unknown }) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const call: Call = {
      method: init?.method ?? 'GET',
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      auth: new Headers(init?.headers).get('authorization'),
    };
    calls.push(call);
    const r = responder(call);
    return new Response(r.json === undefined ? null : JSON.stringify(r.json), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, fetchImpl };
}

const client = (f: typeof fetch) => new FlyClient({ token: 'tok', app: 'alversjo-boxes', region: 'arn', fetch: f });

describe('FlyClient', () => {
  it('creates a volume in the app and region', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ status: 201, json: { id: 'vol_1', name: 'data' } }));
    const v = await client(fetchImpl).createVolume('box_abc', 10);
    expect(v.id).toBe('vol_1');
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://api.machines.dev/v1/apps/alversjo-boxes/volumes',
      auth: 'Bearer tok',
      body: { name: 'box_abc', region: 'arn', size_gb: 10 },
    });
  });

  it('creates a machine with volume mount, no services, restart always', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ status: 200, json: { id: 'm1', name: 'box-abc', state: 'started', region: 'arn' } }));
    const m = await client(fetchImpl).createMachine({
      name: 'box-abc', image: 'registry.fly.io/alversjo-boxes:latest', env: { A: '1' }, volumeId: 'vol_1', memoryMb: 2048, cpus: 1,
    });
    expect(m.id).toBe('m1');
    expect(calls[0].body).toEqual({
      name: 'box-abc',
      region: 'arn',
      config: {
        image: 'registry.fly.io/alversjo-boxes:latest',
        env: { A: '1' },
        guest: { cpu_kind: 'shared', cpus: 1, memory_mb: 2048 },
        mounts: [{ volume: 'vol_1', path: '/work' }],
        restart: { policy: 'always' },
        services: [],
        auto_destroy: false,
      },
    });
  });

  it('start, stop, destroy hit the right endpoints', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ status: 200, json: { ok: true } }));
    const c = client(fetchImpl);
    await c.startMachine('m1');
    await c.stopMachine('m1');
    await c.destroyMachine('m1');
    await c.deleteVolume('vol_1');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST https://api.machines.dev/v1/apps/alversjo-boxes/machines/m1/start',
      'POST https://api.machines.dev/v1/apps/alversjo-boxes/machines/m1/stop',
      'DELETE https://api.machines.dev/v1/apps/alversjo-boxes/machines/m1?force=true',
      'DELETE https://api.machines.dev/v1/apps/alversjo-boxes/volumes/vol_1',
    ]);
  });

  it('throws FlyError with status and body on failure', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 422, json: { error: 'nope' } }));
    await expect(client(fetchImpl).getMachine('m1')).rejects.toMatchObject({ status: 422 } satisfies Partial<FlyError>);
  });

  it('waitForState polls until the state matches', async () => {
    let n = 0;
    const { calls, fetchImpl } = fakeFetch(() => ({ status: 200, json: { id: 'm1', name: 'x', state: n++ < 2 ? 'starting' : 'started', region: 'arn' } }));
    await client(fetchImpl).waitForState('m1', 'started', 5);
    expect(calls.length).toBe(3);
    expect(calls[0].url).toBe('https://api.machines.dev/v1/apps/alversjo-boxes/machines/m1');
  });
});
