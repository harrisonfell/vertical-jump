/**
 * The one seam between the repositories and SQLite.
 *
 * Metro resolves `./executor` to `executor.native.ts` (expo-sqlite) on iOS and
 * Android and to `executor.web.ts` (sql.js) on web. TypeScript and node have no
 * platform resolution, so they land here: this file carries the signatures the
 * platform builds must match, and an `openExecutor` that refuses politely.
 * Tests build their own executor over sql.js directly (see executor.test.ts).
 */

/** Every value SQLite will accept from us. Booleans convert in store/rows.ts. */
export type SqlParam = string | number | null | Uint8Array;

export type SqlParams = readonly SqlParam[];

export interface SqlRunResult {
  /** Rows inserted, updated, or deleted by the statement. */
  readonly changes: number;
  /** Rowid of the last insert on this connection. 0 when nothing was inserted. */
  readonly lastInsertRowId: number;
}

export interface SqlExecutor {
  /** Run one or more statements for their effect. No parameters, no results. */
  execAsync(sql: string): Promise<void>;
  /** Run one parameterised statement and report what it changed. */
  runAsync(sql: string, params?: SqlParams): Promise<SqlRunResult>;
  /** Every row of one parameterised query. */
  getAllAsync<T>(sql: string, params?: SqlParams): Promise<T[]>;
  /** The first row, or null when the query matched nothing. */
  getFirstAsync<T>(sql: string, params?: SqlParams): Promise<T | null>;
  /** Run fn inside a transaction; any throw rolls the whole thing back. */
  withTransactionAsync(fn: () => Promise<void>): Promise<void>;
  /** Release the handle. Flushes pending persistence on web. */
  closeAsync(): Promise<void>;
}

export { DEFAULT_DATABASE_NAME } from './dbName';

export interface OpenExecutorOptions {
  /** File name on native, IndexedDB key on web. */
  readonly databaseName?: string;
}

export function openExecutor(_options?: OpenExecutorOptions): Promise<SqlExecutor> {
  return Promise.reject(
    new Error('No SQLite executor for this platform. Expected executor.native.ts or executor.web.ts.'),
  );
}
