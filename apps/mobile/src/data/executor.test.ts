import { describe, expect, it } from 'vitest';
import { currentSchemaVersion, migrate, MIGRATIONS, SCHEMA_VERSION } from './migrate';
import { openMigratedTestDb, openTestExecutor } from './testing/testDb';

describe('SqlExecutor over sql.js', () => {
  it('runs statements, reads rows, and reports what changed', async () => {
    const db = await openTestExecutor();
    await db.execAsync('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)');

    const insert = await db.runAsync('INSERT INTO t (name) VALUES (?)', ['squat']);
    expect(insert.changes).toBe(1);
    expect(insert.lastInsertRowId).toBeGreaterThan(0);

    const all = await db.getAllAsync<{ id: number; name: string }>('SELECT * FROM t');
    expect(all).toHaveLength(1);
    expect(all[0]?.name).toBe('squat');

    const first = await db.getFirstAsync<{ name: string }>('SELECT name FROM t WHERE id = ?', [
      insert.lastInsertRowId,
    ]);
    expect(first?.name).toBe('squat');

    const none = await db.getFirstAsync('SELECT * FROM t WHERE id = ?', [999]);
    expect(none).toBeNull();

    await db.closeAsync();
  });

  it('rolls the whole transaction back when the body throws', async () => {
    const db = await openTestExecutor();
    await db.execAsync('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)');

    await expect(
      db.withTransactionAsync(async () => {
        await db.runAsync('INSERT INTO t VALUES (1, ?)', ['kept?']);
        throw new Error('nope');
      }),
    ).rejects.toThrow('nope');

    const rows = await db.getAllAsync('SELECT * FROM t');
    expect(rows).toHaveLength(0);

    // The connection is still usable after a rollback.
    await db.runAsync('INSERT INTO t VALUES (2, ?)', ['after']);
    expect(await db.getAllAsync('SELECT * FROM t')).toHaveLength(1);
    await db.closeAsync();
  });

  it('serialises overlapping transactions instead of nesting BEGIN', async () => {
    const db = await openTestExecutor();
    await db.execAsync('CREATE TABLE t (n INTEGER)');

    await Promise.all([
      db.withTransactionAsync(async () => {
        await db.runAsync('INSERT INTO t VALUES (1)');
        await Promise.resolve();
        await db.runAsync('INSERT INTO t VALUES (2)');
      }),
      db.withTransactionAsync(async () => {
        await db.runAsync('INSERT INTO t VALUES (3)');
      }),
    ]);

    const rows = await db.getAllAsync<{ n: number }>('SELECT n FROM t ORDER BY n');
    expect(rows.map((row) => row.n)).toEqual([1, 2, 3]);
    await db.closeAsync();
  });
});

describe('migrations', () => {
  it('applies every migration once and is idempotent', async () => {
    const db = await openTestExecutor();

    expect(await currentSchemaVersion(db)).toBe(0);
    expect(await migrate(db)).toBe(MIGRATIONS.length);
    expect(await currentSchemaVersion(db)).toBe(SCHEMA_VERSION);

    // Running the whole thing a second time must not throw and must not repeat.
    expect(await migrate(db)).toBe(0);
    expect(await currentSchemaVersion(db)).toBe(SCHEMA_VERSION);

    const versions = await db.getAllAsync<{ version: number }>(
      'SELECT version FROM schema_version ORDER BY version',
    );
    expect(versions.map((row) => row.version)).toEqual(MIGRATIONS.map((m) => m.version));
    await db.closeAsync();
  });

  it('creates every table the data contract names', async () => {
    const db = await openMigratedTestDb();
    const rows = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    );
    const tables = new Set(rows.map((row) => row.name));

    const expected = [
      'athlete',
      'pain_status',
      'jump_test_session',
      'jump_rep',
      'metric_pr',
      'exercise',
      'program',
      'program_version',
      'block',
      'week',
      'session',
      'session_exercise',
      'set_log',
      'vbt_set',
      'vbt_rep',
      'lvp_profile',
      'import_batch',
      'whoop_connection',
      'whoop_cycle',
      'whoop_recovery',
      'whoop_sleep',
      'whoop_workout',
      'session_workout_link',
      'webhook_event',
      'athlete_baseline',
      'readiness_signal',
      'autoregulation_status',
      'device_secret',
      'sync_queue',
      'kv',
      'schema_version',
      // Migration 5, for the climbing house rules.
      'readiness_test_session',
      'readiness_outcome',
      'session_answer',
    ];
    for (const table of expected) expect(tables.has(table), `missing table ${table}`).toBe(true);
    await db.closeAsync();
  });

  it('adds the climbing columns to the athlete and a side to a jump rep', async () => {
    const db = await openMigratedTestDb();
    const athleteColumns = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM pragma_table_info('athlete')",
    );
    const names = new Set(athleteColumns.map((row) => row.name));
    for (const column of [
      'secondary_goal',
      'finger_history',
      'grip_mode',
      'finger_pain_ceiling',
      'wall_work_json',
      'session_window_json',
      'valgus_control_json',
      'weaker_side',
      'readiness_config_json',
    ]) {
      expect(names.has(column), `missing column ${column}`).toBe(true);
    }

    const repColumns = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM pragma_table_info('jump_rep')",
    );
    expect(repColumns.map((row) => row.name)).toContain('side');
    await db.closeAsync();
  });
});

describe('the whole database as bytes', () => {
  it('serializes to a SQLite file and can be replaced by one', async () => {
    const source = await openMigratedTestDb();
    await source.runAsync(
      `INSERT INTO kv (key, value, updated_at) VALUES ('marker', 'from source', '2026-09-06T00:00:00.000Z')`,
    );
    const bytes = await source.serializeAsync();
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(String.fromCharCode(...bytes.subarray(0, 15))).toBe('SQLite format 3');
    // Exporting must not close the connection or drop its pragmas.
    const pragma = await source.getFirstAsync<{ foreign_keys: number }>('PRAGMA foreign_keys');
    expect(pragma?.foreign_keys).toBe(1);

    const target = await openMigratedTestDb();
    await target.runAsync(
      `INSERT INTO kv (key, value, updated_at) VALUES ('marker', 'from target', '2026-09-06T00:00:00.000Z')`,
    );
    await target.replaceAsync(bytes);
    const marker = await target.getFirstAsync<{ value: string }>(
      `SELECT value FROM kv WHERE key = 'marker'`,
    );
    expect(marker?.value).toBe('from source');
    expect(await currentSchemaVersion(target)).toBe(SCHEMA_VERSION);
    const replacedPragma = await target.getFirstAsync<{ foreign_keys: number }>('PRAGMA foreign_keys');
    expect(replacedPragma?.foreign_keys).toBe(1);

    // The replaced database is a working one: transactions still serialise.
    await target.withTransactionAsync(async () => {
      await target.runAsync(`UPDATE kv SET value = 'edited' WHERE key = 'marker'`);
    });
    expect((await target.getFirstAsync<{ value: string }>(`SELECT value FROM kv WHERE key = 'marker'`))?.value).toBe('edited');

    await source.closeAsync();
    await target.closeAsync();
  });
});
