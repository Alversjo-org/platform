import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import path from 'node:path';
import { Pool } from 'pg';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export { schema };

const migrationsFolder = path.join(process.cwd(), 'drizzle');

/** Opens a database for the given URL and applies pending migrations. */
export async function createDb(url: string | undefined = process.env.DATABASE_URL): Promise<Db> {
  // PGlite is a dev-box convenience: silently falling back to a local file in
  // production would mean a fresh, empty database on every machine.
  if (process.env.NODE_ENV === 'production' && !url?.startsWith('postgres')) {
    throw new Error('DATABASE_URL must be a postgres:// URL in production');
  }
  if (url && url.startsWith('postgres')) {
    const pool = new Pool({ connectionString: url });
    // An idle client can fail on its own (server restart, network drop). Without a
    // listener node-postgres re-emits that as an uncaught exception on the process.
    pool.on('error', (e) => console.error('pg pool error', e));
    const db = drizzlePg({ client: pool, schema });
    await migratePg(db, { migrationsFolder });
    return db as unknown as Db;
  }
  const target = url && url.startsWith('pglite://') ? url.slice('pglite://'.length) : '.pglite';
  const client = target === 'memory' ? new PGlite() : new PGlite(path.resolve(process.cwd(), target));
  const db = drizzlePglite({ client, schema });
  await migratePglite(db, { migrationsFolder });
  return db as unknown as Db;
}

// Kept on globalThis, not in a module variable: `next dev` loads this module once per
// bundle (pages, API routes, server actions), and separate PGlite handles on one folder
// don't see each other's writes, so a session saved by the sign-in API was missing on pages.
const shared = globalThis as { alversjoDb?: Promise<Db> };
/** Process-wide database, opened on first use. */
export function getDb(): Promise<Db> {
  // A rejected promise must not stay memoised: the next caller would get the old
  // failure forever, even once the database is reachable again.
  shared.alversjoDb ??= createDb().catch((e) => {
    shared.alversjoDb = undefined;
    throw e;
  });
  return shared.alversjoDb;
}
