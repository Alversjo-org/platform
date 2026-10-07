import { describe, expect, it } from 'vitest';
import nextConfig from '../../../next.config';
import { MAX_AVATAR_BYTES } from './constants';

/** Parses Next's SizeLimit format ("8mb", "512kb", or a plain byte count) into bytes. */
function sizeLimitToBytes(limit: number | string): number {
  if (typeof limit === 'number') return limit;
  const match = /^(\d+(?:\.\d+)?)\s*([kmgtp]?)b$/i.exec(limit.trim());
  if (!match) throw new Error(`Unrecognized size limit: ${limit}`);
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4, p: 1024 ** 5 }[unit]!;
  return value * multiplier;
}

describe('next.config server action body size limit', () => {
  it('is larger than MAX_AVATAR_BYTES, so an oversized upload hits the friendly app-level error first', () => {
    const configuredLimit = nextConfig.experimental?.serverActions?.bodySizeLimit;
    expect(configuredLimit).toBeDefined();
    const limitBytes = sizeLimitToBytes(configuredLimit!);
    expect(limitBytes).toBeGreaterThan(MAX_AVATAR_BYTES);
  });
});
