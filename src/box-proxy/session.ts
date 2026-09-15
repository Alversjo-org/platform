import type { BoxSessionResult } from '../lib/boxes/box-session';

export type { BoxSessionResult };

const TTL_MS = 30_000;
const cache = new Map<string, { until: number; result: BoxSessionResult }>();

export async function resolveBoxSession(opts: {
  host: string; cookie: string | undefined; internalUrl: string; secret: string; fetch?: typeof fetch;
}): Promise<BoxSessionResult> {
  const key = `${opts.host}\n${opts.cookie ?? ''}`;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.result;
  const res = await (opts.fetch ?? fetch)(`${opts.internalUrl}/api/internal/box-session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': opts.secret },
    body: JSON.stringify({ host: opts.host, cookie: opts.cookie ?? '' }),
  });
  const result = (await res.json()) as BoxSessionResult;
  if (result.status === 'ok') cache.set(key, { until: Date.now() + TTL_MS, result });
  return result;
}
