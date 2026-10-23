import { describe, expect, it } from 'vitest';
import { areaColor } from './area-color';

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
});
