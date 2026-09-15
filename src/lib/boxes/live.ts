import type { Box } from '@/db/schema';
import type { FlyMachineState } from '@/lib/fly';
import type { FlyOps } from './service';

/** The machine's current state per Fly, not the possibly-stale stored `status`. */
export async function liveState(fly: FlyOps, box: Box): Promise<FlyMachineState | 'unknown'> {
  if (!box.flyMachineId) return 'unknown';
  try {
    const machine = await fly.getMachine(box.flyMachineId);
    return machine.state;
  } catch (err) {
    console.error(`liveState: getMachine failed for box ${box.id}`, err);
    return 'unknown';
  }
}

export async function liveStates(fly: FlyOps, boxes: Box[]): Promise<Map<string, FlyMachineState | 'unknown'>> {
  const states = await Promise.all(boxes.map((b) => liveState(fly, b)));
  return new Map(boxes.map((b, i) => [b.id, states[i]]));
}

/** Badge variant for a live machine state, per the design's status mapping. */
export function stateBadgeVariant(state: FlyMachineState | 'unknown'): 'default' | 'secondary' | 'outline' {
  if (state === 'started') return 'default';
  if (state === 'stopped' || state === 'suspended') return 'secondary';
  return 'outline'; // starting, stopping, created, destroying, destroyed, unknown
}
