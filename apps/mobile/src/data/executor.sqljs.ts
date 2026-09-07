import type { BindParams, Database } from 'sql.js';
import type { SqlExecutor, SqlParams, SqlRunResult } from './executor';
import { reentrantTransaction } from './reentrant';

/**
 * A SqlExecutor over an open sql.js database.
 *
 * sql.js is synchronous, so the only way two callers can interleave is across
 * an `await` inside a transaction body. Transactions are therefore serialised
 * against each other with a promise queue; single statements run straight
 * through, which is safe because every repository write goes through a
 * transaction.
 *
 * A transaction opened inside another gets a savepoint, through the same
 * `reentrantTransaction` the native executor uses. This file used to flatten
 * nesting instead, running the inner body with no boundary of its own, which
 * cost nothing here but hid a real defect: on expo-sqlite the same nesting
 * issues a second BEGIN and fails. Sharing the logic keeps web, node and the
 * device on one set of semantics.
 */

export interface SqlJsExecutorOptions {
  /** Called after every committed write, so web can persist the bytes. */
  readonly onWrite?: () => void;
  /** Called by closeAsync, before the database handle is released. */
  readonly onClose?: () => Promise<void>;
  /**
   * Opens a fresh sql.js database over these bytes, for `replaceAsync`. The
   * executor cannot construct one itself: only the caller holds the engine.
   */
  readonly reopen?: (bytes: Uint8Array) => Database;
}

const WRITE_HEAD = /^\s*(insert|update|delete|replace|create|drop|alter|pragma)/i;

export function createSqlJsExecutor(
  initial: Database,
  options: SqlJsExecutorOptions = {},
): SqlExecutor {
  let db = initial;
  let queue: Promise<void> = Promise.resolve();
  let depth = 0;
  let dirty = false;

  /** Runs fn once every queued transaction has finished, and holds the next. */
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const bind = (params?: SqlParams): BindParams => (params ? [...params] : []);

  const notify = (): void => {
    if (depth > 0 || !dirty) return;
    dirty = false;
    options.onWrite?.();
  };

  const markWrite = (sql: string): void => {
    if (WRITE_HEAD.test(sql)) dirty = true;
  };

  const lastInsertRowId = (): number => {
    const rows = db.exec('SELECT last_insert_rowid() AS id');
    const first = rows[0];
    const value = first?.values[0]?.[0];
    return typeof value === 'number' ? value : 0;
  };

  // The outermost transaction takes its turn in the queue and holds `depth` for
  // as long as it runs, so nothing persists a half-written transaction; every
  // transaction inside it stands on a savepoint.
  const transaction = reentrantTransaction({
    outer: (fn) =>
      exclusive(async () => {
        depth = 1;
        db.run('BEGIN');
        try {
          await fn();
        } catch (error) {
          db.run('ROLLBACK');
          depth = 0;
          throw error;
        }
        db.run('COMMIT');
        depth = 0;
        notify();
      }),
    exec: (sql) => {
      db.run(sql);
      return Promise.resolve();
    },
  });

  const executor: SqlExecutor = {
    execAsync(sql: string): Promise<void> {
      db.exec(sql);
      markWrite(sql);
      notify();
      return Promise.resolve();
    },

    runAsync(sql: string, params?: SqlParams): Promise<SqlRunResult> {
      db.run(sql, bind(params));
      markWrite(sql);
      const result: SqlRunResult = { changes: db.getRowsModified(), lastInsertRowId: lastInsertRowId() };
      notify();
      return Promise.resolve(result);
    },

    getAllAsync<T>(sql: string, params?: SqlParams): Promise<T[]> {
      const statement = db.prepare(sql);
      try {
        statement.bind(bind(params));
        const rows: T[] = [];
        while (statement.step()) rows.push(statement.getAsObject() as T);
        return Promise.resolve(rows);
      } finally {
        statement.free();
      }
    },

    async getFirstAsync<T>(sql: string, params?: SqlParams): Promise<T | null> {
      const rows = await executor.getAllAsync<T>(sql, params);
      return rows[0] ?? null;
    },

    withTransactionAsync(fn: () => Promise<void>): Promise<void> {
      return transaction(fn);
    },

    serializeAsync(): Promise<Uint8Array> {
      // sql.js closes and reopens the connection to export it, which drops
      // the connection-scoped pragma, so it is put back before anyone writes.
      return exclusive(async () => {
        const bytes = db.export();
        db.run('PRAGMA foreign_keys = ON;');
        return bytes;
      });
    },

    replaceAsync(bytes: Uint8Array): Promise<void> {
      const reopen = options.reopen;
      if (reopen === undefined) {
        return Promise.reject(new Error('This executor was opened without a way to reopen.'));
      }
      return exclusive(async () => {
        const next = reopen(bytes);
        next.run('PRAGMA foreign_keys = ON;');
        db.close();
        db = next;
        dirty = true;
        notify();
      });
    },

    async closeAsync(): Promise<void> {
      await queue;
      await options.onClose?.();
      db.close();
    },
  };

  return executor;
}
