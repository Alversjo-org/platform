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

/** A voucher to create. Amounts in öre; Fortnox gets kronor. */
export type FxNewVoucherRow = {
  account: number; debitOre: number; creditOre: number;
  costCentre?: string | null; project?: string | null; transactionInformation?: string;
};
export type FxNewVoucher = {
  series: string;
  transactionDate: string; // YYYY-MM-DD; also picks the financial year (see financialYearId)
  description: string; // max 200
  comments: string; // max 1000; used to find the voucher again after a crash
  rows: FxNewVoucherRow[];
};
export type FxVoucherKey = { year: number; series: string; number: number };
export type FxUploadFile = { fileName: string; contentType: string; data: Buffer };

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
  // Writes (utlägg). financialYearId is Fortnox's financial year id, not a calendar year.
  ensureVoucherSeries(accessToken: string, code: string, description: string): Promise<void>;
  createVoucher(accessToken: string, financialYearId: number, voucher: FxNewVoucher): Promise<FxVoucherKey>;
  findVoucherByComment(accessToken: string, financialYearId: number, series: string, comments: string): Promise<FxVoucherKey | null>;
  uploadInboxFile(accessToken: string, file: FxUploadFile): Promise<{ fileId: string }>;
  connectFileToVoucher(accessToken: string, fileId: string, voucher: FxVoucherKey): Promise<void>;
}

/** The voucher inbox folder ("Verifikationer"), where receipts for vouchers belong. */
const VOUCHER_INBOX_FOLDER = 'inbox_v';

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
    const text = await res.text(); // DELETE answers 204 with no body
    return text ? JSON.parse(text) : null;
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

  function postJson(path: string, accessToken: string, body: unknown): Promise<unknown> {
    return fetchJson(path, accessToken, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
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
          // Fortnox sends "" (not null) for a row without a cost centre or project; storing ""
          // would break the foreign keys to fx_cost_centre / fx_project.
          costCentreCode: r.CostCenter || null,
          fxProjectCode: r.Project || null,
          transactionInfo: r.Transactioninformation,
          removed: r.Removed,
        })),
      };
    },

    async ensureVoucherSeries(accessToken, code, description) {
      try {
        await fetchJson(`/voucherseries/${encodeURIComponent(code)}`, accessToken);
      } catch (e) {
        if (!(e instanceof FortnoxApiError) || (e.status !== 404 && e.status !== 400)) throw e;
        await postJson('/voucherseries', accessToken, { VoucherSeries: { Code: code, Description: description, Manual: false } });
      }
    },

    async createVoucher(accessToken, financialYearId, voucher) {
      const kronor = (ore: number) => Math.round(ore) / 100;
      const data = (await postJson(`/vouchers?financialyear=${financialYearId}`, accessToken, {
        Voucher: {
          VoucherSeries: voucher.series,
          TransactionDate: voucher.transactionDate,
          Description: voucher.description.slice(0, 200),
          Comments: voucher.comments.slice(0, 1000),
          VoucherRows: voucher.rows.map((r) => ({
            Account: r.account,
            Debit: kronor(r.debitOre),
            Credit: kronor(r.creditOre),
            ...(r.costCentre ? { CostCenter: r.costCentre } : {}),
            ...(r.project ? { Project: r.project } : {}),
            ...(r.transactionInformation ? { TransactionInformation: r.transactionInformation.slice(0, 100) } : {}),
          })),
        },
      })) as { Voucher: { VoucherSeries: string; VoucherNumber: number; Year: number } };
      return { year: data.Voucher.Year, series: data.Voucher.VoucherSeries, number: data.Voucher.VoucherNumber };
    },

    async findVoucherByComment(accessToken, financialYearId, series, comments) {
      const rows = await fetchAllPages<{ VoucherSeries: string; VoucherNumber: number; Year: number; Comments?: string | null }>(
        `/vouchers/sublist/${encodeURIComponent(series)}?financialyear=${financialYearId}`, accessToken,
        (d) => (d as { Vouchers: { VoucherSeries: string; VoucherNumber: number; Year: number; Comments?: string | null }[] }).Vouchers,
      );
      const hit = rows.find((v) => (v.Comments ?? '').trim() === comments.trim());
      return hit ? { year: hit.Year ?? financialYearId, series: hit.VoucherSeries, number: hit.VoucherNumber } : null;
    },

    async uploadInboxFile(accessToken, file) {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(file.data)], { type: file.contentType }), file.fileName);
      const data = (await fetchJson(`/inbox?folderId=${VOUCHER_INBOX_FOLDER}`, accessToken, { method: 'POST', body: form })) as { File: { Id: string } };
      return { fileId: data.File.Id };
    },

    async connectFileToVoucher(accessToken, fileId, voucher) {
      // VoucherYear pins the financial year. Without it Fortnox uses the year currently selected
      // as default in its UI and silently attaches the file to another year's voucher.
      const data = (await postJson('/voucherfileconnections', accessToken, {
        VoucherFileConnection: { FileId: fileId, VoucherNumber: String(voucher.number), VoucherSeries: voucher.series, VoucherYear: voucher.year },
      })) as { VoucherFileConnection: { VoucherYear?: number; VoucherNumber?: string; VoucherSeries?: string } };
      const c = data.VoucherFileConnection;
      if ((c.VoucherYear !== undefined && c.VoucherYear !== voucher.year) || (c.VoucherNumber !== undefined && Number(c.VoucherNumber) !== voucher.number)) {
        await fetchJson(`/voucherfileconnections/${encodeURIComponent(fileId)}`, accessToken, { method: 'DELETE' }).catch(() => undefined);
        throw new Error(`Fortnox attached the receipt to ${c.VoucherSeries}${c.VoucherNumber} in year ${c.VoucherYear}, not ${voucher.series}${voucher.number} in year ${voucher.year}; the link was removed again`);
      }
    },
  };
}
