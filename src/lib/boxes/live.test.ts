import { describe, expect, it, vi } from 'vitest';
import type { Box } from '@/db/schema';
import type { FlyOps } from './service';
import { liveState, liveStates } from './live';

function fakeFly(overrides: Partial<FlyOps> = {}): FlyOps {
  return {
    async createVolume(name) { return { id: `vol_${name}` }; },
    async deleteVolume() {},
    async createMachine(input) { return { id: `m_${input.name}`, name: input.name, state: 'started', region: 'arn' }; },
    async getMachine() { throw new Error('not implemented'); },
    async startMachine() {},
    async stopMachine() {},
    async destroyMachine() {},
    async waitForState() {},
    ...overrides,
  };
}

function fakeBox(overrides: Partial<Box> = {}): Box {
  return {
    id: 'abc123abc123',
    name: 'T',
    profile: 'contributor',
    flyMachineId: 'm_box-abc123abc123',
    flyVolumeId: 'vol_box_abc123abc123',
    status: 'started',
    jwtSecret: 'jwt-secret',
    ownerUserId: 'admin',
    createdAt: new Date(),
    ...overrides,
  } as Box;
}

describe('liveState', () => {
  it('returns the machine state from Fly when a machine id exists', async () => {
    const fly = fakeFly({ async getMachine(id) { return { id, name: 'box-abc', state: 'stopped', region: 'arn' }; } });
    expect(await liveState(fly, fakeBox())).toBe('stopped');
  });

  it('returns unknown when the box has no machine id', async () => {
    const fly = fakeFly();
    expect(await liveState(fly, fakeBox({ flyMachineId: null }))).toBe('unknown');
  });

  it('returns unknown and logs when getMachine throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fly = fakeFly({ async getMachine() { throw new Error('fly is down'); } });
    expect(await liveState(fly, fakeBox())).toBe('unknown');
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('liveStates', () => {
  it('resolves states for multiple boxes in parallel', async () => {
    const fly = fakeFly({ async getMachine(id) { return { id, name: 'box', state: id === 'm1' ? 'started' : 'stopped', region: 'arn' }; } });
    const boxes = [fakeBox({ id: 'b1', flyMachineId: 'm1' }), fakeBox({ id: 'b2', flyMachineId: 'm2' })];
    const states = await liveStates(fly, boxes);
    expect(states.get('b1')).toBe('started');
    expect(states.get('b2')).toBe('stopped');
  });
});
