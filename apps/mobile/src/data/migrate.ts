import type { SqlExecutor } from './executor';
import { MIGRATION_0001 } from './sql/0001_init';
import { MIGRATION_0002 } from './sql/0002_instruments';
import { MIGRATION_0003 } from './sql/0003_context';
import { MIGRATION_0004 } from './sql/0004_sync_op_id';
import { MIGRATION_0005 } from './sql/0005_climber';
import { MIGRATION_0006 } from './sql/0006_best_sets';

/**
 * Migrations are applied in order, each inside its own transaction, and each
 * recorded in schema_version. Running migrate twice is a no-op: the version
 * table gates it, and every statement is IF NOT EXISTS besides, so a database
 * that was interrupted halfway still converges.
 */

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: '0001_init', sql: MIGRATION_0001 },
  { version: 2, name: '0002_instruments', sql: MIGRATION_0002 },
  { version: 3, name: '0003_context', sql: MIGRATION_0003 },
  { version: 4, name: '0004_sync_op_id', sql: MIGRATION_0004 },
  { version: 5, name: '0005_climber', sql: MIGRATION_0005 },
  { version: 6, name: '0006_best_sets', sql: MIGRATION_0006 },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

const SCHEMA_TABLE = `
CREATE TABLE IF NOT EXISTS schema_version (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at TEXT NOT NULL
);`;

export async function currentSchemaVersion(db: SqlExecutor): Promise<number> {
  await db.execAsync(SCHEMA_TABLE);
  const row = await db.getFirstAsync<{ version: number | null }>(
    'SELECT MAX(version) AS version FROM schema_version',
  );
  return row?.version ?? 0;
}

/** Applies every migration newer than the stored version. Returns how many ran. */
export async function migrate(db: SqlExecutor): Promise<number> {
  const from = await currentSchemaVersion(db);
  let applied = 0;

  for (const migration of MIGRATIONS) {
    if (migration.version <= from) continue;
    await db.withTransactionAsync(async () => {
      await db.execAsync(migration.sql);
      await db.runAsync(
        'INSERT OR REPLACE INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)',
        [migration.version, migration.name, new Date().toISOString()],
      );
    });
    applied += 1;
  }

  return applied;
}
