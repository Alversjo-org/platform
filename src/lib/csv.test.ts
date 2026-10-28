import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';

describe('parseCsv', () => {
  it('splits quoted fields containing commas, and unescapes doubled quotes', () => {
    expect(parseCsv('a,"b, c","d ""e"" f"\n1,2,3')).toEqual([['a', 'b, c', 'd "e" f'], ['1', '2', '3']]);
  });

  it('drops blank lines', () => {
    expect(parseCsv('a,b\n\n  \nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });
});
