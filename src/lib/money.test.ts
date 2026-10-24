import { describe, expect, it } from 'vitest';
import { oreToSek, sekToOre } from './money';

describe('money', () => {
  it('sekToOre converts whole kronor', () => {
    expect(sekToOre(3)).toBe(300);
    expect(sekToOre(0)).toBe(0);
  });

  it('sekToOre converts fractional kronor without floating-point drift', () => {
    expect(sekToOre(19.99)).toBe(1999);
    expect(sekToOre(0.1)).toBe(10);
  });

  it('oreToSek is the inverse', () => {
    expect(oreToSek(300)).toBe(3);
    expect(oreToSek(1999)).toBe(19.99);
  });
});
