import sharp from 'sharp';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAP_IMAGE_HEIGHT, MAP_IMAGE_WIDTH } from './constants';

describe('map image asset', () => {
  it('matches the dimensions recorded in constants.ts', async () => {
    const meta = await sharp(path.join(process.cwd(), 'public/map/alversjo.jpg')).metadata();
    expect(meta.width).toBe(MAP_IMAGE_WIDTH);
    expect(meta.height).toBe(MAP_IMAGE_HEIGHT);
  });
});
