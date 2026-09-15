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
  if (url && url.startsWith('postgres')) {
    const db = drizzlePg({ client: new Pool({ connectionString: url }), schema });
    await migratePg(db, { migrationsFolder });
    return db as unknown as Db;
  }
  const target = url && url.startsWith('pglite://') ? url.slice('pglite://'.length) : '.pglite';
  const client = target === 'memory' ? new PGlite() : new PGlite(path.resolve(process.cwd(), target));
  const db = drizzlePglite({ client, schema });
  await migratePglite(db, { migrationsFolder });
  return db as unknown as Db;
}

let dbPromise: Promise<Db> | undefined;
/** Process-wide database, opened on first use. */
export function getDb(): Promise<Db> {
  dbPromise ??= createDb();
  return dbPromise;
}
