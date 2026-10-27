import { describe, expect, it } from 'vitest';
import { POST } from './route';

describe('POST /api/cron/fortnox-sync', () => {
  it('rejects without the correct bearer secret', async () => {
    process.env.CRON_SECRET = 'shh';
    const res = await POST(new Request('http://x', { headers: { authorization: 'Bearer wrong' } }));
    expect(res.status).toBe(401);
  });
});
