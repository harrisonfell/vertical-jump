import { File } from 'expo-file-system';
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

async function openHandle(databaseName: string): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(databaseName);
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await db.execAsync('PRAGMA busy_timeout = 5000;');
  return db;
}

async function open(databaseName: string): Promise<SqlExecutor> {
  return wrap(await openHandle(databaseName), databaseName);
}

function bind(params?: SqlParams): SQLite.SQLiteBindValue[] {
  return params ? [...params] : [];
}

/** The file expo-sqlite opens for this name, in its default directory. */
function databaseFile(databaseName: string): File {
  const directory: unknown = SQLite.defaultDatabaseDirectory;
  return new File(String(directory), databaseName);
}

function wrap(initial: SQLite.SQLiteDatabase, databaseName: string): SqlExecutor {
  let db = initial;
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

    async serializeAsync(): Promise<Uint8Array> {
      // Fold the write-ahead log into the file first, so the bytes carry
      // every committed write and not only the ones already checkpointed.
      await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE);');
      return db.serializeAsync();
    },

    async replaceAsync(bytes: Uint8Array): Promise<void> {
      // Close, drop the file and its WAL sidecars, write the new file, reopen.
      // expo-sqlite's delete removes the sidecars with the file, which matters:
      // a stale WAL beside a new file would be replayed over it on open.
      await db.closeAsync();
      await SQLite.deleteDatabaseAsync(databaseName);
      const file = databaseFile(databaseName);
      file.write(bytes);
      db = await openHandle(databaseName);
    },

    closeAsync(): Promise<void> {
      return db.closeAsync();
    },
  };
}
