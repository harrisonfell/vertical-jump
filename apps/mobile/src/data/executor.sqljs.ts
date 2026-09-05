import type { BindParams, Database } from 'sql.js';
import type { SqlExecutor, SqlParams, SqlRunResult } from './executor';

/**
 * A SqlExecutor over an open sql.js database.
 *
 * sql.js is synchronous, so the only way two callers can interleave is across
 * an `await` inside a transaction body. Transactions are therefore serialised
 * against each other with a promise queue; single statements run straight
 * through, which is safe because every repository write goes through a
 * transaction.
 */

export interface SqlJsExecutorOptions {
  /** Called after every committed write, so web can persist the bytes. */
  readonly onWrite?: () => void;
  /** Called by closeAsync, before the database handle is released. */
  readonly onClose?: () => Promise<void>;
}

const WRITE_HEAD = /^\s*(insert|update|delete|replace|create|drop|alter|pragma)/i;

export function createSqlJsExecutor(db: Database, options: SqlJsExecutorOptions = {}): SqlExecutor {
  let queue: Promise<void> = Promise.resolve();
  let depth = 0;
  let dirty = false;

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
      if (depth > 0) return fn();

      const run = async (): Promise<void> => {
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
      };

      const next = queue.then(run, run);
      queue = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },

    async closeAsync(): Promise<void> {
      await queue;
      await options.onClose?.();
      db.close();
    },
  };

  return executor;
}
