/**
 * The database handle.
 *
 * One postgres.js pool for the whole server, cached across hot reloads and
 * across warm Vercel invocations. Tests never come through here: they build a
 * pglite database and pass it in, so no environment variable is needed to run
 * the suite.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { env } from '../lib/env';

export type Database = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as {
  vertSql?: ReturnType<typeof postgres>;
  vertDb?: Database;
};

/** The pooled connection. Vercel keeps warm functions, so one pool is enough. */
export function getDb(): Database {
  if (globalForDb.vertDb !== undefined) return globalForDb.vertDb;
  const sql =
    globalForDb.vertSql ??
    postgres(env().DATABASE_URL, { max: 1, prepare: false, idle_timeout: 20 });
  const db = drizzle(sql, { schema });
  globalForDb.vertSql = sql;
  globalForDb.vertDb = db;
  return db;
}
