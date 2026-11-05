import { randomUUID } from 'node:crypto';
import { and, desc, eq, lt } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { FxSyncRunTrigger } from '@/db/schema';
import { FortnoxApiError, type FortnoxClient, type FxFinancialYearData, type FxVoucherData } from './client';
import { getValidAccessToken, markNeedsReauth, NeedsReauthError } from './connection-service';

const SYNC_TOPICS = ['vouchers', 'projects', 'cost-centers', 'financial-years'] as const;

/** A full import takes about 10 minutes; a run this old died with the server (a deploy, a crash). */
const STALE_RUN_MS = 30 * 60 * 1000;

/** The financial year containing today, plus the one immediately before it (by end date), deduplicated. */
export function pickRecentFinancialYears(financialYears: FxFinancialYearData[]): FxFinancialYearData[] {
  const sortedByEnd = [...financialYears].sort((a, b) => b.toDate.localeCompare(a.toDate));
  const today = new Date().toISOString().slice(0, 10);
  const currentIndex = sortedByEnd.findIndex((fy) => fy.fromDate <= today && today <= fy.toDate);
  const startIndex = currentIndex === -1 ? 0 : currentIndex;
  return sortedByEnd.slice(startIndex, startIndex + 2);
}

export async function recordSyncCompletion(db: Db): Promise<void> {
  for (const topic of SYNC_TOPICS) {
    await db.insert(schema.fxSyncState).values({ topic, lastFullSyncAt: new Date() })
      .onConflictDoUpdate({ target: schema.fxSyncState.topic, set: { lastFullSyncAt: new Date() } });
  }
}

export async function syncReferenceData(db: Db, client: FortnoxClient, accessToken: string, year: number): Promise<void> {
  const financialYears = await client.getFinancialYears(accessToken);
  for (const fy of financialYears) {
    await db.insert(schema.fxFinancialYear).values({
      id: randomUUID(), fortnoxId: fy.fortnoxId, fromDate: fy.fromDate, toDate: fy.toDate, lockedUntilDate: fy.lockedUntilDate,
    }).onConflictDoUpdate({
      target: schema.fxFinancialYear.fortnoxId,
      set: { fromDate: fy.fromDate, toDate: fy.toDate, lockedUntilDate: fy.lockedUntilDate, syncedAt: new Date() },
    });
  }

  const accounts = await client.getAccounts(accessToken, year);
  for (const account of accounts) {
    await db.insert(schema.fxAccount).values({ id: randomUUID(), year: account.year, number: account.number, name: account.name, active: account.active })
      .onConflictDoUpdate({
        target: [schema.fxAccount.year, schema.fxAccount.number],
        set: { name: account.name, active: account.active, syncedAt: new Date() },
      });
  }

  const costCentres = await client.getCostCentres(accessToken);
  for (const cc of costCentres) {
    await db.insert(schema.fxCostCentre).values({ id: randomUUID(), code: cc.code, name: cc.name, active: cc.active })
      .onConflictDoUpdate({ target: schema.fxCostCentre.code, set: { name: cc.name, active: cc.active, syncedAt: new Date() } });
  }

  const fxProjects = await client.getFxProjects(accessToken);
  for (const p of fxProjects) {
    await db.insert(schema.fxProject).values({ id: randomUUID(), code: p.code, name: p.name, active: p.active })
      .onConflictDoUpdate({ target: schema.fxProject.code, set: { name: p.name, active: p.active, syncedAt: new Date() } });
  }
}

async function upsertVoucher(db: Db, data: FxVoucherData): Promise<void> {
  await db.transaction(async (tx) => {
    const [voucher] = await tx.insert(schema.fxVoucher).values({
      id: randomUUID(),
      year: data.year,
      series: data.series,
      number: data.number,
      date: data.date,
      description: data.description,
      referenceType: data.referenceType,
      referenceNumber: data.referenceNumber,
      comments: data.comments,
      hasAttachment: data.hasAttachment,
    }).onConflictDoUpdate({
      target: [schema.fxVoucher.year, schema.fxVoucher.series, schema.fxVoucher.number],
      set: {
        date: data.date,
        description: data.description,
        referenceType: data.referenceType,
        referenceNumber: data.referenceNumber,
        comments: data.comments,
        hasAttachment: data.hasAttachment,
        syncedAt: new Date(),
      },
    }).returning({ id: schema.fxVoucher.id });

    for (const row of data.rows) {
      await tx.insert(schema.fxVoucherRow).values({
        id: randomUUID(),
        voucherId: voucher.id,
        rowIndex: row.rowIndex,
        account: row.account,
        debitSek: row.debitSek,
        creditSek: row.creditSek,
        costCentreCode: row.costCentreCode,
        fxProjectCode: row.fxProjectCode,
        transactionInfo: row.transactionInfo,
        removed: row.removed,
      }).onConflictDoUpdate({
        target: [schema.fxVoucherRow.voucherId, schema.fxVoucherRow.rowIndex],
        set: {
          account: row.account,
          debitSek: row.debitSek,
          creditSek: row.creditSek,
          costCentreCode: row.costCentreCode,
          fxProjectCode: row.fxProjectCode,
          transactionInfo: row.transactionInfo,
          removed: row.removed,
          syncedAt: new Date(),
        },
      });
    }

    // A row previously mirrored for this voucher but absent from the current response (Fortnox
    // may omit a struck row rather than return it with Removed: true — unverified, see the
    // reference doc's open sandbox question) is marked removed rather than left to look live.
    const currentIndices = new Set(data.rows.map((row) => row.rowIndex));
    const mirroredRows = await tx.select().from(schema.fxVoucherRow).where(eq(schema.fxVoucherRow.voucherId, voucher.id));
    for (const mirroredRow of mirroredRows) {
      if (!currentIndices.has(mirroredRow.rowIndex) && !mirroredRow.removed) {
        await tx.update(schema.fxVoucherRow).set({ removed: true, syncedAt: new Date() }).where(eq(schema.fxVoucherRow.id, mirroredRow.id));
      }
    }
  });
}

export async function syncVouchersForYear(db: Db, client: FortnoxClient, accessToken: string, year: number): Promise<void> {
  const keys = await client.listVoucherKeys(accessToken, year);
  for (const key of keys) {
    const voucher = await client.getVoucher(accessToken, year, key.series, key.number);
    await upsertVoucher(db, voucher);
  }
}

export async function runFirstImport(db: Db, client: FortnoxClient, accessToken: string): Promise<number[]> {
  const financialYears = await client.getFinancialYears(accessToken);
  const yearsInScope = pickRecentFinancialYears(financialYears).map((fy) => fy.fortnoxId);

  for (const year of yearsInScope) {
    await syncReferenceData(db, client, accessToken, year);
    await syncVouchersForYear(db, client, accessToken, year);
  }

  await recordSyncCompletion(db);
  return yearsInScope;
}

/**
 * Takes the import lock. Returns the new run's id, or null if another run is under way: each run
 * paces itself to Fortnox's rate limit on its own, so two at once exceed it and fail.
 */
export async function claimSyncRun(db: Db, trigger: FxSyncRunTrigger): Promise<string | null> {
  await db.update(schema.fxSyncRun)
    .set({ status: 'failed', error: 'Stopped without finishing (the server restarted).', finishedAt: new Date() })
    .where(and(eq(schema.fxSyncRun.status, 'running'), lt(schema.fxSyncRun.startedAt, new Date(Date.now() - STALE_RUN_MS))));
  const [run] = await db.insert(schema.fxSyncRun).values({ id: randomUUID(), trigger }).onConflictDoNothing().returning({ id: schema.fxSyncRun.id });
  return run?.id ?? null;
}

export type SyncRunResult = { status: 'succeeded'; years: number[] } | { status: 'needs_reauth' } | { status: 'failed'; error: string };

async function finishSyncRun(db: Db, runId: string, error: string | null): Promise<void> {
  await db.update(schema.fxSyncRun)
    .set({ status: error ? 'failed' : 'succeeded', error: error?.slice(0, 500) ?? null, finishedAt: new Date() })
    .where(eq(schema.fxSyncRun.id, runId));
}

/** Runs a claimed import to the end and records how it went. Never throws. */
export async function executeSyncRun(db: Db, client: FortnoxClient, runId: string): Promise<SyncRunResult> {
  try {
    const accessToken = await getValidAccessToken(db, client);
    const years = await runFirstImport(db, client, accessToken);
    await finishSyncRun(db, runId, null);
    return { status: 'succeeded', years };
  } catch (error) {
    if (error instanceof NeedsReauthError || (error instanceof FortnoxApiError && error.status === 401)) {
      if (error instanceof FortnoxApiError) await markNeedsReauth(db, error.message);
      await finishSyncRun(db, runId, 'Fortnox stopped accepting our access.');
      return { status: 'needs_reauth' };
    }
    console.error('Fortnox import failed:', error);
    const message = error instanceof Error ? error.message : String(error);
    await finishSyncRun(db, runId, message);
    return { status: 'failed', error: message };
  }
}

export async function latestSyncRun(db: Db): Promise<typeof schema.fxSyncRun.$inferSelect | null> {
  const [run] = await db.select().from(schema.fxSyncRun).orderBy(desc(schema.fxSyncRun.startedAt)).limit(1);
  return run ?? null;
}
