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

  it('reads an empty cost centre or project on a voucher row as none', async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({ Voucher: {
      VoucherSeries: 'A', VoucherNumber: 1, TransactionDate: '2026-11-01', Description: 'x', ReferenceType: null, ReferenceNumber: null, Comments: null,
      VoucherRows: [
        { Account: 6990, Debit: 100, Credit: 0, CostCenter: '', Project: '', Transactioninformation: '', Removed: false },
        { Account: 1930, Debit: 0, Credit: 100, CostCenter: 'BAST', Project: '7', Transactioninformation: '', Removed: false },
      ],
    } }), { status: 200 })) as typeof fetch;
    const voucher = await createFortnoxClient(fakeFetch).getVoucher('token', 1, 'A', 1);
    expect(voucher.rows.map((r) => [r.costCentreCode, r.fxProjectCode])).toEqual([[null, null], ['BAST', '7']]);
  });
});

describe('Fortnox writes', () => {
  function recorder(responses: Record<string, () => Response>) {
    const calls: { method: string; url: string; body: unknown }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      calls.push({ method, url, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body });
      const key = Object.keys(responses).find((k) => `${method} ${url}`.includes(k));
      return key ? responses[key]() : new Response('not found', { status: 404 });
    }) as typeof fetch;
    return { calls, client: createFortnoxClient(fakeFetch) };
  }

  it('creates a voucher in the given financial year, in kronor, with dimensions on the cost row', async () => {
    const { calls, client } = recorder({
      'POST https://api.fortnox.se/3/vouchers?financialyear=7': () =>
        new Response(JSON.stringify({ Voucher: { VoucherSeries: 'U', VoucherNumber: 12, Year: 7 } }), { status: 201 }),
    });
    const key = await client.createVoucher('t', 7, {
      series: 'U', transactionDate: '2026-11-01', description: 'Utlägg', comments: 'expense:abc',
      rows: [
        { account: 6990, debitOre: 10000, creditOre: 0, costCentre: 'BYGG', project: '3' },
        { account: 2640, debitOre: 2500, creditOre: 0 },
        { account: 2890, debitOre: 0, creditOre: 12500, transactionInformation: 'Anna' },
      ],
    });
    expect(key).toEqual({ year: 7, series: 'U', number: 12 });
    expect(calls[0].body).toEqual({
      Voucher: {
        VoucherSeries: 'U', TransactionDate: '2026-11-01', Description: 'Utlägg', Comments: 'expense:abc',
        VoucherRows: [
          { Account: 6990, Debit: 100, Credit: 0, CostCenter: 'BYGG', Project: '3' },
          { Account: 2640, Debit: 25, Credit: 0 },
          { Account: 2890, Debit: 0, Credit: 125, TransactionInformation: 'Anna' },
        ],
      },
    });
  });

  it('creates a missing voucher series', async () => {
    const { calls, client } = recorder({
      'POST https://api.fortnox.se/3/voucherseries': () => new Response(JSON.stringify({ VoucherSeries: { Code: 'U' } }), { status: 201 }),
    });
    await client.ensureVoucherSeries('t', 'U', 'Utlägg');
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST']);
    expect(calls[1].body).toEqual({ VoucherSeries: { Code: 'U', Description: 'Utlägg', Manual: false } });
  });

  it('finds a voucher again by its comment', async () => {
    const { client } = recorder({
      'sublist/U': () => new Response(JSON.stringify({
        Vouchers: [{ VoucherSeries: 'U', VoucherNumber: 1, Year: 7, Comments: 'expense:x' }, { VoucherSeries: 'U', VoucherNumber: 2, Year: 7, Comments: 'expense:abc' }],
        MetaInformation: { '@TotalPages': 1 },
      }), { status: 200 }),
    });
    expect(await client.findVoucherByComment('t', 7, 'U', 'expense:abc')).toEqual({ year: 7, series: 'U', number: 2 });
    expect(await client.findVoucherByComment('t', 7, 'U', 'expense:none')).toBeNull();
  });

  it('pins the voucher year when attaching a receipt, and undoes a link to the wrong year', async () => {
    const ok = recorder({
      'POST https://api.fortnox.se/3/voucherfileconnections': () =>
        new Response(JSON.stringify({ VoucherFileConnection: { FileId: 'f1', VoucherNumber: '12', VoucherSeries: 'U', VoucherYear: 7 } }), { status: 201 }),
    });
    await ok.client.connectFileToVoucher('t', 'f1', { year: 7, series: 'U', number: 12 });
    expect(ok.calls[0].body).toEqual({ VoucherFileConnection: { FileId: 'f1', VoucherNumber: '12', VoucherSeries: 'U', VoucherYear: 7 } });

    const wrong = recorder({
      'POST https://api.fortnox.se/3/voucherfileconnections': () =>
        new Response(JSON.stringify({ VoucherFileConnection: { FileId: 'f1', VoucherNumber: '12', VoucherSeries: 'U', VoucherYear: 6 } }), { status: 201 }),
      'DELETE https://api.fortnox.se/3/voucherfileconnections/f1': () => new Response(null, { status: 204 }),
    });
    await expect(wrong.client.connectFileToVoucher('t', 'f1', { year: 7, series: 'U', number: 12 })).rejects.toThrow(/not U12 in year 7/);
    expect(wrong.calls.map((c) => c.method)).toEqual(['POST', 'DELETE']);
  });

  it('uploads a receipt to the voucher inbox', async () => {
    const { calls, client } = recorder({
      'POST https://api.fortnox.se/3/inbox?folderId=inbox_v': () => new Response(JSON.stringify({ File: { Id: 'file-1' } }), { status: 201 }),
    });
    expect(await client.uploadInboxFile('t', { fileName: 'kvitto.jpg', contentType: 'image/jpeg', data: Buffer.from('jpg') })).toEqual({ fileId: 'file-1' });
    expect(calls[0].body).toBeInstanceOf(FormData);
  });
});
