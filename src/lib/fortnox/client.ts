import { createRateLimiter } from './rate-limiter';

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
    return res.json();
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
      return data.FinancialYears.map((y) => ({ fortnoxId: y.Id, fromDate: y.FromDate, toDate: y.ToDate, lockedUntilDate: null }));
    },

    async getAccounts(accessToken, year) {
      const data = (await fetchJson(`/accounts?financialyear=${year}`, accessToken)) as { Accounts: { Number: number; Description: string; Active: boolean }[] };
      return data.Accounts.map((a) => ({ year, number: a.Number, name: a.Description, active: a.Active }));
    },

    async getCostCentres(accessToken) {
      const data = (await fetchJson('/costcenters', accessToken)) as { CostCenters: { Code: string; Description: string; Active: boolean }[] };
      return data.CostCenters.map((c) => ({ code: c.Code, name: c.Description, active: c.Active }));
    },

    async getFxProjects(accessToken) {
      const data = (await fetchJson('/projects', accessToken)) as { Projects: { ProjectNumber: string; Description: string; Status: string }[] };
      return data.Projects.map((p) => ({ code: p.ProjectNumber, name: p.Description, active: p.Status !== 'Completed' }));
    },

    async listVoucherKeys(accessToken, financialYear) {
      const keys: { series: string; number: number }[] = [];
      let page = 1;
      for (;;) {
        const data = (await fetchJson(`/vouchers?financialyear=${financialYear}&page=${page}`, accessToken)) as {
          Vouchers: { VoucherSeries: string; VoucherNumber: number }[];
          MetaInformation?: { '@TotalPages'?: number };
        };
        keys.push(...data.Vouchers.map((v) => ({ series: v.VoucherSeries, number: v.VoucherNumber })));
        const totalPages = data.MetaInformation?.['@TotalPages'] ?? 1;
        if (page >= totalPages) break;
        page++;
      }
      return keys;
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
