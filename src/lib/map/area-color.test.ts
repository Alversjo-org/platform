import { describe, expect, it } from 'vitest';
import { areaColor } from './area-color';
import { SEED_AREAS } from './seed-data';

describe('areaColor', () => {
  it('is deterministic for the same id', () => {
    expect(areaColor('area-a')).toBe(areaColor('area-a'));
  });
  it('differs between two different ids', () => {
    expect(areaColor('area-a')).not.toBe(areaColor('area-b'));
  });
  it('returns an hsl() string', () => {
    expect(areaColor('area-a')).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
  });

  it('spreads the real seeded section ids across visually distinct hues', () => {
    const hues = SEED_AREAS.map((a) => Number(areaColor(a.id).match(/^hsl\((\d+),/)![1]));
    for (let i = 0; i < hues.length; i++) {
      for (let j = i + 1; j < hues.length; j++) {
        const diff = Math.abs(hues[i] - hues[j]);
        const circularDiff = Math.min(diff, 360 - diff);
        expect(circularDiff).toBeGreaterThan(6);
      }
    }
  });
});
