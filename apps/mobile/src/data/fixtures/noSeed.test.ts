import { describe, expect, it } from 'vitest';
import { prefillOwnerIfEmpty } from '@/app/ownerPrefill';
import { deleteAllData } from '@/features/settings/deleteAll';
import type { SqlExecutor } from '../executor';
import { KV_KEYS, kvGet } from '../store/kv';
import { openMigratedTestDb } from '../testing/testDb';
import { fixtureMode, seedIfEmpty } from './seed';

/**
 * A plain boot seeds nothing.
 *
 * The demo fixtures exist for screenshots and for the invariant tests, and the
 * owner does not want a single one of their rows: `npm run web` with no flags,
 * and every TestFlight build, must open on an empty store. The flags are read
 * once at boot and neither of them defaults to on.
 */

const TODAY = '2026-09-05';
const ZONE = 'America/New_York';

/** Every table a fixture writes to. All of them stay at zero. */
const TABLES = [
  'athlete',
  'program',
  'program_version',
  'block',
  'week',
  'session',
  'session_exercise',
  'set_log',
  'jump_test_session',
  'jump_rep',
  'readiness_signal',
  'whoop_connection',
  'whoop_cycle',
  'whoop_recovery',
  'whoop_sleep',
  'whoop_workout',
];

async function count(db: SqlExecutor, table: string): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
  return row?.n ?? 0;
}

describe('a boot with no flags set', () => {
  it('reads both flags as off when the environment is empty', () => {
    expect(fixtureMode(undefined)).toBe('off');
    expect(fixtureMode('')).toBe('off');
  });

  it('leaves every table empty after migrations', async () => {
    const db = await openMigratedTestDb();

    expect(await seedIfEmpty(db, TODAY, ZONE, fixtureMode(undefined))).toBe(false);
    expect(await prefillOwnerIfEmpty(db, TODAY, ZONE, false)).toBe(false);

    for (const table of TABLES) {
      expect([table, await count(db, table)]).toEqual([table, 0]);
    }
    expect(await kvGet(db, KV_KEYS.fixtureSeededAt)).toBeNull();
    await db.closeAsync();
  });
});

describe('Delete all data', () => {
  it('clears the seeded flag, so a later boot without the flag stays empty', async () => {
    const db = await openMigratedTestDb();
    expect(await seedIfEmpty(db, TODAY, ZONE, 'seed')).toBe(true);
    expect(await kvGet(db, KV_KEYS.fixtureSeededAt)).not.toBeNull();

    await deleteAllData(db);
    expect(await kvGet(db, KV_KEYS.fixtureSeededAt)).toBeNull();
    for (const table of TABLES) {
      expect([table, await count(db, table)]).toEqual([table, 0]);
    }

    // The next open, with no flag set: still nothing.
    expect(await seedIfEmpty(db, TODAY, ZONE, fixtureMode(undefined))).toBe(false);
    expect(await prefillOwnerIfEmpty(db, TODAY, ZONE, false)).toBe(false);
    expect(await count(db, 'athlete')).toBe(0);
    await db.closeAsync();
  });
});
