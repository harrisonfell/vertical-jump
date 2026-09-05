import initSqlJs from 'sql.js/dist/sql-wasm.js';
import { createSqlJsExecutor } from '../executor.sqljs';
import type { SqlExecutor } from '../executor';
import { migrate } from '../migrate';

/**
 * An in-memory database for vitest, over the same sql.js engine the web build
 * uses. Node resolves the wasm payload beside the module, so there is nothing
 * to configure.
 */

export async function openTestExecutor(): Promise<SqlExecutor> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  return createSqlJsExecutor(db);
}

export async function openMigratedTestDb(): Promise<SqlExecutor> {
  const db = await openTestExecutor();
  await migrate(db);
  return db;
}
