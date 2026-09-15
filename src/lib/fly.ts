export type FlyMachineState =
  | 'created' | 'starting' | 'started' | 'stopping' | 'stopped' | 'suspended' | 'destroying' | 'destroyed';

export interface FlyMachine { id: string; name: string; state: FlyMachineState; region: string }

export interface CreateMachineInput {
  name: string; image: string; env: Record<string, string>; volumeId: string; memoryMb: number; cpus: number;
}

export class FlyError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'FlyError';
  }
}

export class FlyClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly opts: { token: string; app: string; region: string; fetch?: typeof fetch; baseUrl?: string }) {
    this.fetchImpl = opts.fetch ?? fetch;
    this.baseUrl = opts.baseUrl ?? 'https://api.machines.dev/v1';
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}/apps/${this.opts.app}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.opts.token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new FlyError(res.status, `Fly ${method} ${path} → ${res.status}: ${text}`);
    return (text ? JSON.parse(text) : undefined) as T;
  }

  createVolume(name: string, sizeGb: number) {
    return this.call<{ id: string }>('POST', '/volumes', { name, region: this.opts.region, size_gb: sizeGb });
  }

  deleteVolume(id: string) {
    return this.call<void>('DELETE', `/volumes/${id}`);
  }

  createMachine(input: CreateMachineInput) {
    return this.call<FlyMachine>('POST', '/machines', {
      name: input.name,
      region: this.opts.region,
      config: {
        image: input.image,
        env: input.env,
        guest: { cpu_kind: 'shared', cpus: input.cpus, memory_mb: input.memoryMb },
        mounts: [{ volume: input.volumeId, path: '/work' }],
        restart: { policy: 'always' },
        services: [],
        auto_destroy: false,
      },
    });
  }

  getMachine(id: string) {
    return this.call<FlyMachine>('GET', `/machines/${id}`);
  }

  startMachine(id: string) {
    return this.call<void>('POST', `/machines/${id}/start`);
  }

  stopMachine(id: string) {
    return this.call<void>('POST', `/machines/${id}/stop`);
  }

  destroyMachine(id: string) {
    return this.call<void>('DELETE', `/machines/${id}?force=true`);
  }

  async waitForState(id: string, state: FlyMachineState, timeoutSec = 60) {
    const deadline = Date.now() + timeoutSec * 1000;
    for (;;) {
      const m = await this.getMachine(id);
      if (m.state === state) return;
      if (Date.now() > deadline) throw new FlyError(408, `machine ${id} did not reach ${state} (is ${m.state})`);
      await new Promise((r) => setTimeout(r, timeoutSec >= 10 ? 2000 : 10));
    }
  }
}
