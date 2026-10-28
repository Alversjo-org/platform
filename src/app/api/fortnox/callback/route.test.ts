import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('GET /api/fortnox/callback', () => {
  it('redirects to /fortnox with an error when Fortnox reports a denied consent', async () => {
    const res = await GET(new Request('http://x/api/fortnox/callback?error=access_denied'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/fortnox?error=access_denied');
  });

  it('redirects to /fortnox with an error when no code is present and no error either', async () => {
    const res = await GET(new Request('http://x/api/fortnox/callback'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/fortnox?error=missing_code');
  });

  it('rejects a state that does not match the stored cookie', async () => {
    const req = new Request('http://x/api/fortnox/callback?code=abc&state=wrong', { headers: { cookie: 'fortnox_oauth_state=right' } });
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/fortnox?error=state_mismatch');
  });
});
