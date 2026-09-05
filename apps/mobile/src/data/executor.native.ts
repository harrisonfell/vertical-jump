import * as SQLite from 'expo-sqlite';
import { DEFAULT_DATABASE_NAME } from './dbName';
import type {
  OpenExecutorOptions,
  SqlExecutor,
  SqlParams,
  SqlRunResult,
} from './executor';

/**
 * The native executor: expo-sqlite in the app's Documents directory, which is
 * the location iOS backs up and never purges. expo-sqlite's own default is
 * `<Documents>/SQLite`, so the directory argument is deliberately left off
 * rather than restated with a value typed `any` by the SDK.
 *
 * WAL keeps a long session's writes off the read path; foreign keys are opt-in
 * per connection in SQLite, so they are turned on at every open.
 */

export function openExecutor(options?: OpenExecutorOptions): Promise<SqlExecutor> {
  return open(options?.databaseName ?? DEFAULT_DATABASE_NAME);
}

async function open(databaseName: string): Promise<SqlExecutor> {
  const db = await SQLite.openDatabaseAsync(databaseName);
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await db.execAsync('PRAGMA busy_timeout = 5000;');
  return wrap(db);
}

function bind(params?: SqlParams): SQLite.SQLiteBindValue[] {
  return params ? [...params] : [];
}

function wrap(db: SQLite.SQLiteDatabase): SqlExecutor {
  return {
    execAsync(sql: string): Promise<void> {
      return db.execAsync(sql);
    },

    async runAsync(sql: string, params?: SqlParams): Promise<SqlRunResult> {
      const result = await db.runAsync(sql, bind(params));
      return { changes: result.changes, lastInsertRowId: result.lastInsertRowId };
    },

    getAllAsync<T>(sql: string, params?: SqlParams): Promise<T[]> {
      return db.getAllAsync<T>(sql, bind(params));
    },

    async getFirstAsync<T>(sql: string, params?: SqlParams): Promise<T | null> {
      const row = await db.getFirstAsync<T>(sql, bind(params));
      return row ?? null;
    },

    withTransactionAsync(fn: () => Promise<void>): Promise<void> {
      return db.withTransactionAsync(fn);
    },

    closeAsync(): Promise<void> {
      return db.closeAsync();
    },
  };
}
