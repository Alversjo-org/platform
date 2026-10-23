import { GRID_COLS, GRID_ROWS } from './constants';

export function cellRect(col: number, row: number): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: col / GRID_COLS,
    y0: row / GRID_ROWS,
    x1: (col + 1) / GRID_COLS,
    y1: (row + 1) / GRID_ROWS,
  };
}
