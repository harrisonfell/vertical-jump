/**
 * The database a route handler uses.
 *
 * Production hands back the pooled postgres.js handle from db/client.ts, which
 * needs DATABASE_URL. Tests hand in a pglite database instead, so the whole
 * suite runs in process with no server and no environment. One seam, set once
 * per test file, cleared in afterEach.
 */

import { getDb, type Database } from '../../db/client';

let injected: Database | null = null;

/** Tests only. Pass null to go back to the pooled connection. */
export function setDatabaseForTests(db: Database | null): void {
  injected = db;
}

/** The handle every route handler reads through. */
export function database(): Database {
  return injected ?? getDb();
}
