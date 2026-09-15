import { describe, expect, it } from 'vitest';
import { isBoxesSubdomain, parseBoxHost } from './host';

const boxesDomain = 'boxes.alversjo.land';

describe('parseBoxHost', () => {
  it.each([
    ['valid id', 'abc123abc123.boxes.alversjo.land', { host: 'abc123abc123.boxes.alversjo.land', boxId: 'abc123abc123' }],
    ['upper-case host', 'ABC123ABC123.BOXES.ALVERSJO.LAND', { host: 'abc123abc123.boxes.alversjo.land', boxId: 'abc123abc123' }],
    ['host with port', 'abc123abc123.boxes.alversjo.land:3000', { host: 'abc123abc123.boxes.alversjo.land', boxId: 'abc123abc123' }],
    ['trailing dot', 'abc123abc123.boxes.alversjo.land.', { host: 'abc123abc123.boxes.alversjo.land', boxId: 'abc123abc123' }],
    ['suffix confusion', 'abc123abc123.boxes.alversjo.land.attacker.com', null],
    ['multi-label', 'abc123abc123.x.boxes.alversjo.land', null],
    ['non-hex id', 'zzzzzzzzzzzz.boxes.alversjo.land', null],
    ['undefined', undefined, null],
    ['platform host', 'alversjo.land', null],
  ] as const)('%s', (_name, input, expected) => {
    expect(parseBoxHost(input, boxesDomain)).toEqual(expected);
  });
});

describe('isBoxesSubdomain', () => {
  it.each([
    ['valid box host', 'abc123abc123.boxes.alversjo.land', true],
    ['junk box host', 'nope.boxes.alversjo.land', true],
    ['multi-label under the domain', 'a.b.boxes.alversjo.land', true],
    ['with port and trailing dot', 'NOPE.boxes.alversjo.land.:3000', true],
    ['the boxes domain itself', 'boxes.alversjo.land', false],
    ['suffix confusion', 'abc123abc123.boxes.alversjo.land.attacker.com', false],
    ['platform host', 'members.alversjo.land', false],
    ['undefined', undefined, false],
  ] as const)('%s', (_name, input, expected) => {
    expect(isBoxesSubdomain(input, boxesDomain)).toBe(expected);
  });
});
