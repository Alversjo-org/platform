export type RateLimiter = { acquire(): Promise<void> };

/** Sliding-window limiter: at most `maxCalls` calls resolve within any `windowMs` period. */
export function createRateLimiter(opts: { maxCalls?: number; windowMs?: number; now?: () => number } = {}): RateLimiter {
  const maxCalls = opts.maxCalls ?? 25;
  const windowMs = opts.windowMs ?? 5000;
  const now = opts.now ?? Date.now;
  const callTimes: number[] = [];

  async function acquire(): Promise<void> {
    const cutoff = now() - windowMs;
    while (callTimes.length > 0 && callTimes[0] <= cutoff) callTimes.shift();

    if (callTimes.length >= maxCalls) {
      const waitMs = callTimes[0] + windowMs - now();
      await new Promise((resolve) => setTimeout(resolve, Math.max(waitMs, 0)));
      return acquire();
    }

    callTimes.push(now());
  }

  return { acquire };
}
