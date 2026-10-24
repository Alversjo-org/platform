import { describe, expect, it } from 'vitest';
import { cellsInPolygon } from './polygon';

describe('cellsInPolygon', () => {
  it('returns the left half of a 4x4 grid for a square covering x in [0, 0.5]', () => {
    const cells = cellsInPolygon([[0, 0], [0.5, 0], [0.5, 1], [0, 1]], 4, 4);
    const keys = cells.map((c) => `${c.col},${c.row}`).sort();
    expect(keys).toEqual(['0,0', '0,1', '0,2', '0,3', '1,0', '1,1', '1,2', '1,3'].sort());
  });
  it('returns no cells for a degenerate zero-area polygon', () => {
    expect(cellsInPolygon([[0.1, 0.1], [0.1, 0.1], [0.1, 0.1]], 4, 4)).toEqual([]);
  });
});
