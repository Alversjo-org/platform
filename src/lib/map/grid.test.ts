import { describe, expect, it } from 'vitest';
import { cellRect } from './grid';
import { GRID_COLS, GRID_ROWS } from './constants';

describe('cellRect', () => {
  it('returns the top-left cell flush with the image origin', () => {
    expect(cellRect(0, 0)).toEqual({ x0: 0, y0: 0, x1: 1 / GRID_COLS, y1: 1 / GRID_ROWS });
  });
  it('returns the bottom-right cell flush with the image edge, not overflowing past 1', () => {
    const r = cellRect(GRID_COLS - 1, GRID_ROWS - 1);
    expect(r.x1).toBeCloseTo(1, 10);
    expect(r.y1).toBeCloseTo(1, 10);
  });
});
