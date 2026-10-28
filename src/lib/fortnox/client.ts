import { createRateLimiter } from './rate-limiter';

export class FortnoxApiError extends Error {
  constructor(public readonly status: number, public readonly path: string, body: string) {
    super(`Fortnox API ${path} returned ${status}: ${body}`);
    this.name = 'FortnoxApiError';
  }
}

export type FortnoxTokens = { accessToken: string; refreshToken: string; expiresAt: Date; scope: string };
export type FxFinancialYearData = { fortnoxId: number; fromDate: string; toDate: string; lockedUntilDate: string | null };
export type FxAccountData = { year: number; number: number; name: string; active: boolean };
export type FxCostCentreData = { code: string; name: string; active: boolean };
export type FxProjectData = { code: string; name: string; active: boolean };
export type FxVoucherRowData = {
  rowIndex: number; account: number; debitSek: number; creditSek: number;
  costCentreCode: string | null; fxProjectCode: string | null; transactionInfo: string | null; removed: boolean;
};
export type FxVoucherData = {
  year: number; series: string; number: number; date: string; description: string;
  referenceType: string | null; referenceNumber: string | null; comments: string | null; hasAttachment: boolean;
  rows: FxVoucherRowData[];
};

export interface FortnoxClient {
  getAuthorizationUrl(state: string): string;
  exchangeCode(code: string): Promise<FortnoxTokens>;
  refreshTokens(refreshToken: string): Promise<FortnoxTokens>;
  getFinancialYears(accessToken: string): Promise<FxFinancialYearData[]>;
  getAccounts(accessToken: string, year: number): Promise<FxAccountData[]>;
  getCostCentres(accessToken: string): Promise<FxCostCentreData[]>;
  getFxProjects(accessToken: string): Promise<FxProjectData[]>;
  listVoucherKeys(accessToken: string, financialYear: number): Promise<{ series: string; number: number }[]>;
  getVoucher(accessToken: string, financialYear: number, series: string, number: number): Promise<FxVoucherData>;
}

const AUTH_URL = 'https://apps.fortnox.se/oauth-v1/auth';
const TOKEN_URL = 'https://apps.fortnox.se/oauth-v1/token';
const API_BASE = 'https://api.fortnox.se/3';

const SCOPES = ['bookkeeping', 'project', 'costcenter', 'supplierinvoice', 'supplier', 'payment', 'settings', 'inbox', 'archive', 'connectfile', 'companyinformation'];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function tokensFromResponse(body: { access_token: string; refresh_token: string; expires_in: number; scope: string }): FortnoxTokens {
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: new Date(Date.now() + body.expires_in * 1000),
    scope: body.scope,
  };
}

/** Process-wide-shaped Fortnox client; `fetchImpl` is injectable so tests avoid real network calls. */
export function createFortnoxClient(fetchImpl: typeof fetch = fetch): FortnoxClient {
  const limiter = createRateLimiter();

  async function fetchJson(path: string, accessToken: string, init: RequestInit = {}): Promise<unknown> {
    await limiter.acquire();
    const res = await fetchWithRetry(`${API_BASE}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new FortnoxApiError(res.status, path, await res.text());
    return res.json();
  }

  /** Pages through a list endpoint until `MetaInformation['@TotalPages']` is reached. */
  async function fetchAllPages<T>(basePath: string, accessToken: string, extractItems: (data: unknown) => T[]): Promise<T[]> {
    const items: T[] = [];
    const separator = basePath.includes('?') ? '&' : '?';
    let page = 1;
    for (;;) {
      const data = await fetchJson(`${basePath}${separator}page=${page}`, accessToken);
      items.push(...extractItems(data));
      const totalPages = (data as { MetaInformation?: { '@TotalPages'?: number } }).MetaInformation?.['@TotalPages'] ?? 1;
      if (page >= totalPages) break;
      page++;
    }
    return items;
  }

  async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    const res = await fetchImpl(url, init);
    if (res.status !== 429) return res;
    const retryAfterSeconds = Number(res.headers.get('Retry-After') ?? '1');
    await new Promise((resolve) => setTimeout(resolve, retryAfterSeconds * 1000));
    const retryRes = await fetchImpl(url, init);
    if (retryRes.status === 429) throw new Error('Fortnox API rate limit exceeded after one retry');
    return retryRes;
  }

  async function exchangeToken(body: Record<string, string>): Promise<FortnoxTokens> {
    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${requireEnv('FORTNOX_CLIENT_ID')}:${requireEnv('FORTNOX_CLIENT_SECRET')}`).toString('base64')}`,
      },
      body: new URLSearchParams(body),
    });
    if (!res.ok) throw new Error(`Fortnox token endpoint returned ${res.status}`);
    return tokensFromResponse(await res.json());
  }

  return {
    getAuthorizationUrl(state) {
      const url = new URL(AUTH_URL);
      url.searchParams.set('client_id', requireEnv('FORTNOX_CLIENT_ID'));
      url.searchParams.set('redirect_uri', requireEnv('FORTNOX_REDIRECT_URI'));
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('account_type', 'service');
      url.searchParams.set('scope', SCOPES.join(' '));
      url.searchParams.set('state', state);
      return url.toString();
    },

    exchangeCode(code) {
      return exchangeToken({ grant_type: 'authorization_code', code, redirect_uri: requireEnv('FORTNOX_REDIRECT_URI') });
    },

    refreshTokens(refreshToken) {
      return exchangeToken({ grant_type: 'refresh_token', refresh_token: refreshToken });
    },

    async getFinancialYears(accessToken) {
      const data = (await fetchJson('/financialyears', accessToken)) as { FinancialYears: { Id: number; FromDate: string; ToDate: string }[] };
      // lockedUntilDate is a placeholder: /settings/lockedperiod (scope already requested) is not
      // called this slice. Nothing reads this column yet — don't rely on it until it's populated.
      return data.FinancialYears.map((y) => ({ fortnoxId: y.Id, fromDate: y.FromDate, toDate: y.ToDate, lockedUntilDate: null }));
    },

    async getAccounts(accessToken, year) {
      const rows = await fetchAllPages<{ Number: number; Description: string; Active: boolean }>(
        `/accounts?financialyear=${year}`, accessToken, (data) => (data as { Accounts: { Number: number; Description: string; Active: boolean }[] }).Accounts,
      );
      return rows.map((a) => ({ year, number: a.Number, name: a.Description, active: a.Active }));
    },

    async getCostCentres(accessToken) {
      const rows = await fetchAllPages<{ Code: string; Description: string; Active: boolean }>(
        '/costcenters', accessToken, (data) => (data as { CostCenters: { Code: string; Description: string; Active: boolean }[] }).CostCenters,
      );
      return rows.map((c) => ({ code: c.Code, name: c.Description, active: c.Active }));
    },

    async getFxProjects(accessToken) {
      const rows = await fetchAllPages<{ ProjectNumber: string; Description: string; Status: string }>(
        '/projects', accessToken, (data) => (data as { Projects: { ProjectNumber: string; Description: string; Status: string }[] }).Projects,
      );
      return rows.map((p) => ({ code: p.ProjectNumber, name: p.Description, active: p.Status !== 'Completed' }));
    },

    async listVoucherKeys(accessToken, financialYear) {
      const rows = await fetchAllPages<{ VoucherSeries: string; VoucherNumber: number }>(
        `/vouchers?financialyear=${financialYear}`, accessToken, (data) => (data as { Vouchers: { VoucherSeries: string; VoucherNumber: number }[] }).Vouchers,
      );
      return rows.map((v) => ({ series: v.VoucherSeries, number: v.VoucherNumber }));
    },

    async getVoucher(accessToken, financialYear, series, number) {
      const data = (await fetchJson(`/vouchers/${series}/${number}?financialyear=${financialYear}`, accessToken)) as {
        Voucher: {
          VoucherSeries: string; VoucherNumber: number; TransactionDate: string; Description: string;
          ReferenceType: string | null; ReferenceNumber: string | null; Comments: string | null;
          VoucherRows: { Account: number; Debit: number; Credit: number; CostCenter: string | null; Project: string | null; Transactioninformation: string | null; Removed: boolean }[];
        };
      };
      const v = data.Voucher;
      return {
        year: financialYear,
        series: v.VoucherSeries,
        number: v.VoucherNumber,
        date: v.TransactionDate,
        description: v.Description,
        referenceType: v.ReferenceType,
        referenceNumber: v.ReferenceNumber,
        comments: v.Comments,
        // Placeholder: knowing whether a voucher has a file needs /voucherfileconnections, a
        // separate call this slice doesn't make (that's the receipts slice). Don't rely on this
        // until it's populated — a future "missing receipts" view must not read it as-is.
        hasAttachment: false,
        rows: v.VoucherRows.map((r, i) => ({
          rowIndex: i + 1,
          account: r.Account,
          debitSek: Math.round(r.Debit * 100),
          creditSek: Math.round(r.Credit * 100),
          costCentreCode: r.CostCenter,
          fxProjectCode: r.Project,
          transactionInfo: r.Transactioninformation,
          removed: r.Removed,
        })),
      };
    },
  };
}
