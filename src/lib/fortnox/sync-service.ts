import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { FortnoxClient, FxVoucherData } from './client';

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
    const [existing] = await db.select().from(schema.fxAccount).where(and(eq(schema.fxAccount.year, account.year), eq(schema.fxAccount.number, account.number)));
    if (existing) {
      await db.update(schema.fxAccount).set({ name: account.name, active: account.active, syncedAt: new Date() }).where(eq(schema.fxAccount.id, existing.id));
    } else {
      await db.insert(schema.fxAccount).values({ id: randomUUID(), year: account.year, number: account.number, name: account.name, active: account.active });
    }
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

async function upsertVoucher(db: Db, data: FxVoucherData): Promise<string> {
  const [existing] = await db.select().from(schema.fxVoucher)
    .where(and(eq(schema.fxVoucher.year, data.year), eq(schema.fxVoucher.series, data.series), eq(schema.fxVoucher.number, data.number)));

  const voucherId = existing?.id ?? randomUUID();
  const fields = {
    date: data.date,
    description: data.description,
    referenceType: data.referenceType,
    referenceNumber: data.referenceNumber,
    comments: data.comments,
    hasAttachment: data.hasAttachment,
    syncedAt: new Date(),
  };

  if (existing) {
    await db.update(schema.fxVoucher).set(fields).where(eq(schema.fxVoucher.id, voucherId));
  } else {
    await db.insert(schema.fxVoucher).values({ id: voucherId, year: data.year, series: data.series, number: data.number, ...fields });
  }

  for (const row of data.rows) {
    const [existingRow] = await db.select().from(schema.fxVoucherRow)
      .where(and(eq(schema.fxVoucherRow.voucherId, voucherId), eq(schema.fxVoucherRow.rowIndex, row.rowIndex)));

    const rowFields = {
      account: row.account,
      debitSek: row.debitSek,
      creditSek: row.creditSek,
      costCentreCode: row.costCentreCode,
      fxProjectCode: row.fxProjectCode,
      transactionInfo: row.transactionInfo,
      removed: row.removed,
      syncedAt: new Date(),
    };

    if (existingRow) {
      await db.update(schema.fxVoucherRow).set(rowFields).where(eq(schema.fxVoucherRow.id, existingRow.id));
    } else {
      await db.insert(schema.fxVoucherRow).values({ id: randomUUID(), voucherId, rowIndex: row.rowIndex, ...rowFields });
    }
  }

  return voucherId;
}

export async function syncVouchersForYear(db: Db, client: FortnoxClient, accessToken: string, year: number): Promise<void> {
  const keys = await client.listVoucherKeys(accessToken, year);
  for (const key of keys) {
    const voucher = await client.getVoucher(accessToken, year, key.series, key.number);
    await upsertVoucher(db, voucher);
  }
}

const SYNC_TOPICS = ['vouchers', 'projects', 'cost-centers', 'financial-years'] as const;

export async function runFirstImport(db: Db, client: FortnoxClient, accessToken: string): Promise<void> {
  const financialYears = await client.getFinancialYears(accessToken);
  const sortedByEnd = [...financialYears].sort((a, b) => b.toDate.localeCompare(a.toDate));
  const yearsInScope = sortedByEnd.slice(0, 2).map((fy) => fy.fortnoxId);

  for (const year of yearsInScope) {
    await syncReferenceData(db, client, accessToken, year);
    await syncVouchersForYear(db, client, accessToken, year);
  }

  for (const topic of SYNC_TOPICS) {
    await db.insert(schema.fxSyncState).values({ topic, lastFullSyncAt: new Date() })
      .onConflictDoUpdate({ target: schema.fxSyncState.topic, set: { lastFullSyncAt: new Date() } });
  }
}
