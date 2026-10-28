import { describe, expect, it, vi } from 'vitest';
import { createRateLimiter } from './rate-limiter';

describe('createRateLimiter', () => {
  it('allows calls up to the limit without delay', async () => {
    const limiter = createRateLimiter({ maxCalls: 25, windowMs: 5000 });
    const start = Date.now();
    for (let i = 0; i < 25; i++) await limiter.acquire();
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('delays the 26th call until the window has room', async () => {
    vi.useFakeTimers();
    const limiter = createRateLimiter({ maxCalls: 2, windowMs: 1000 });
    await limiter.acquire();
    await limiter.acquire();
    const third = limiter.acquire();
    let resolved = false;
    third.then(() => { resolved = true; });
    await vi.advanceTimersByTimeAsync(999);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(resolved).toBe(true);
    vi.useRealTimers();
  });
});
