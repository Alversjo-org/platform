import { afterEach, describe, expect, it } from 'vitest';
import { createFortnoxClient, FortnoxApiError } from './client';

describe('createFortnoxClient', () => {
  afterEach(() => {
    delete process.env.FORTNOX_CLIENT_ID;
    delete process.env.FORTNOX_CLIENT_SECRET;
    delete process.env.FORTNOX_REDIRECT_URI;
  });

  it('builds the authorization URL with the service-account scopes', () => {
    process.env.FORTNOX_CLIENT_ID = 'cid';
    process.env.FORTNOX_REDIRECT_URI = 'https://platform.alversjo.land/api/fortnox/callback';
    const client = createFortnoxClient();
    const url = new URL(client.getAuthorizationUrl('state123'));
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('account_type')).toBe('service');
    expect(url.searchParams.get('state')).toBe('state123');
    expect(url.searchParams.get('scope')?.split(' ').sort()).toEqual(
      ['archive', 'bookkeeping', 'companyinformation', 'connectfile', 'costcenter', 'inbox', 'payment', 'project', 'settings', 'supplier', 'supplierinvoice'].sort(),
    );
  });

  it('retries once on HTTP 429 and succeeds', async () => {
    let calls = 0;
    const fakeFetch = (async (_url: string) => {
      calls++;
      if (calls === 1) return new Response('', { status: 429, headers: { 'Retry-After': '0' } });
      return new Response(JSON.stringify({ FinancialYears: [] }), { status: 200 });
    }) as typeof fetch;
    const client = createFortnoxClient(fakeFetch);
    await client.getFinancialYears('token');
    expect(calls).toBe(2);
  });

  it('throws a FortnoxApiError carrying the status on a non-ok response', async () => {
    const fakeFetch = (async () => new Response('token revoked', { status: 401 })) as typeof fetch;
    const client = createFortnoxClient(fakeFetch);
    await expect(client.getFinancialYears('token')).rejects.toMatchObject(new FortnoxApiError(401, '/financialyears', 'token revoked'));
  });

  it('paginates /accounts across multiple pages instead of returning only page 1', async () => {
    const urls: string[] = [];
    const fakeFetch = (async (url: string) => {
      urls.push(url);
      const page = new URL(url).searchParams.get('page');
      if (page === '1') {
        return new Response(JSON.stringify({ Accounts: [{ Number: 1000, Description: 'A', Active: true }], MetaInformation: { '@TotalPages': 2 } }), { status: 200 });
      }
      return new Response(JSON.stringify({ Accounts: [{ Number: 2000, Description: 'B', Active: true }], MetaInformation: { '@TotalPages': 2 } }), { status: 200 });
    }) as typeof fetch;
    const client = createFortnoxClient(fakeFetch);
    const accounts = await client.getAccounts('token', 2027);
    expect(accounts.map((a) => a.number)).toEqual([1000, 2000]);
    expect(urls).toHaveLength(2);
  });
});
