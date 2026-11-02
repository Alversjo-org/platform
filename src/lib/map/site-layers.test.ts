import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SITE_BBOX } from './constants';

const dir = path.join(process.cwd(), 'public/map/site');
const files = readdirSync(dir).filter((f) => f.endsWith('.geojson'));
const load = (f: string) => JSON.parse(readFileSync(path.join(dir, f), 'utf8'));

function positions(c: unknown): number[][] {
  return Array.isArray(c) && typeof c[0] === 'number' ? [c as number[]] : (c as unknown[]).flatMap(positions);
}

describe('static site layers (public/map/site)', () => {
  it.each(files)('%s is a FeatureCollection with every position [lon, lat] inside the site', (f) => {
    const fc = load(f);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features.length).toBeGreaterThan(0);
    const [w, s, e, n] = SITE_BBOX;
    for (const feature of fc.features) {
      expect(feature.properties.kind).toBeTruthy();
      for (const [lon, lat] of positions(feature.geometry.coordinates)) {
        // Neighbours lie just outside the property, so allow ~2 km of slack.
        expect(lon).toBeGreaterThan(w - 0.03);
        expect(lon).toBeLessThan(e + 0.03);
        expect(lat).toBeGreaterThan(s - 0.02);
        expect(lat).toBeLessThan(n + 0.02);
      }
    }
  });

  it('keeps only permanent features: no Borderland-only points', () => {
    const names = load('points.geojson').features.map((f: { properties: { name: string } }) => f.properties.name);
    expect(names).toEqual(expect.arrayContaining(['The Well', 'Water tap', 'Downtown Toilets', 'The Barn', 'Machine Hall', 'The Brewery', 'Sheep barn']));
    for (const banned of ['Main parking', 'Threshold Check-in "Gate"', 'The Sanctuary', 'Gate Toilets']) expect(names).not.toContain(banned);
  });
});
