import type { BoxSessionResult } from '../lib/boxes/box-session';

export type { BoxSessionResult };

const TTL_MS = 30_000;
const MAX_ENTRIES = 1000;
const cache = new Map<string, { until: number; result: BoxSessionResult }>();

function pruneExpired(now: number): void {
  for (const [key, entry] of cache) {
    if (entry.until <= now) cache.delete(key);
  }
}

function cacheOk(key: string, result: BoxSessionResult, now: number): void {
  pruneExpired(now);
  // Delete first so a refresh of an existing key moves it to the newest
  // (last-inserted) position instead of leaving it at its original spot, which
  // would make the size-cap eviction below treat a just-used key as the oldest.
  cache.delete(key);
  if (cache.size >= MAX_ENTRIES) {
    // Map preserves insertion order: the first key is the oldest entry.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { until: now + TTL_MS, result });
}

export async function resolveBoxSession(opts: {
  host: string; cookie: string | undefined; internalUrl: string; secret: string; fetch?: typeof fetch;
}): Promise<BoxSessionResult> {
  const key = `${opts.host}\n${opts.cookie ?? ''}`;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.result;

  let result: BoxSessionResult;
  try {
    const res = await (opts.fetch ?? fetch)(`${opts.internalUrl}/api/internal/box-session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': opts.secret },
      body: JSON.stringify({ host: opts.host, cookie: opts.cookie ?? '' }),
    });
    if (!res.ok) {
      result = { status: 'unavailable' };
    } else {
      try {
        result = (await res.json()) as BoxSessionResult;
      } catch {
        result = { status: 'unavailable' };
      }
    }
  } catch {
    result = { status: 'unavailable' };
  }

  if (result.status === 'ok') cacheOk(key, result, Date.now());
  return result;
}
