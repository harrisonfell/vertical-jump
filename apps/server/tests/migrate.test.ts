/**
 * The migrations, applied to a real Postgres, in process.
 *
 * pglite is Postgres compiled to wasm, so this runs the same SQL Neon will run
 * with nothing installed and no DATABASE_URL. If a column name here drifts
 * from the phone's, this is where it shows up. They are applied through
 * drizzle's migrator, which is what `npm run db:migrate` runs, so the journal
 * that decides what has already run is under test too.
 */

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../src/db/schema';
import { applyMigrations } from './support/migrations';

async function freshDb(): Promise<ReturnType<typeof drizzle<typeof schema>>> {
  const db = drizzle(new PGlite(), { schema });
  await applyMigrations(db);
  return db;
}

describe('the migrations', () => {
  let db: Awaited<ReturnType<typeof freshDb>>;

  beforeAll(async () => {
    db = await freshDb();
  }, 60_000);

  it('creates every table the server writes to', async () => {
    const rows = await db.$client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const names = rows.rows.map((row) => row.table_name);
    for (const table of [
      'device_secret',
      'pair_code',
      'login_attempt',
      'sync_op',
      'whoop_connection',
      'whoop_cycle',
      'whoop_recovery',
      'whoop_sleep',
      'whoop_workout',
      'webhook_event',
      'session_workout_link',
      'athlete',
      'program',
      'week',
      'session',
      'set_log',
      'jump_test_session',
      'jump_rep',
      'readiness_test_session',
      'readiness_outcome',
    ]) {
      expect(names).toContain(table);
    }
  });

  it('can be applied twice, because the journal decides what has run', async () => {
    const twice = drizzle(new PGlite(), { schema });
    await applyMigrations(twice);
    // A bare re-apply of the SQL would die on "relation already exists"; the
    // migrator reads its own journal and does nothing the second time.
    await expect(applyMigrations(twice)).resolves.toBeUndefined();
    const rows = await twice.$client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    expect(rows.rows.map((row) => row.table_name)).toContain('whoop_start_ticket');
  }, 60_000);

  it('round-trips a recovery mirror with its nullable scored fields', async () => {
    const updatedAt = new Date('2026-09-04T10:41:19.882Z');
    await db.insert(schema.whoopRecovery).values([
      {
        id: 'b4f0b8a2-1d2c-4f6e-9d5a-7c3e21ab90f4',
        cycleId: '93845123',
        sleepId: 'b4f0b8a2-1d2c-4f6e-9d5a-7c3e21ab90f4',
        scoreState: 'SCORED',
        userCalibrating: false,
        recoveryScore: 71,
        restingHeartRate: 48,
        hrvRmssdMilli: 92.4187,
        spo2Percentage: 96.5,
        skinTempCelsius: 33.7,
        timezoneOffset: '-04:00',
        localDate: '2026-09-03',
        raw: { score_state: 'SCORED' },
        updatedAt,
      },
      {
        id: 'c81d9e77-3a55-4a11-b0f3-2d4c6e8f1a02',
        cycleId: '93851907',
        sleepId: 'c81d9e77-3a55-4a11-b0f3-2d4c6e8f1a02',
        scoreState: 'PENDING_SCORE',
        localDate: '2026-09-04',
        raw: { score_state: 'PENDING_SCORE' },
        updatedAt,
      },
    ]);

    const scored = await db
      .select()
      .from(schema.whoopRecovery)
      .where(eq(schema.whoopRecovery.scoreState, 'SCORED'));
    expect(scored).toHaveLength(1);
    expect(scored[0]?.recoveryScore).toBe(71);
    expect(scored[0]?.localDate).toBe('2026-09-03');

    const pending = await db
      .select()
      .from(schema.whoopRecovery)
      .where(eq(schema.whoopRecovery.scoreState, 'PENDING_SCORE'));
    // A score is absent unless SCORED: it stays null, it never becomes a zero.
    expect(pending[0]?.recoveryScore).toBeNull();
    expect(pending[0]?.hrvRmssdMilli).toBeNull();
  });

  it('carries the climbing columns and the two readiness tables', async () => {
    await db.insert(schema.athlete).values({
      id: 'athlete_owner',
      sport: 'speed_climbing',
      secondaryGoal: 'upper_body_power',
      fingerHistory: true,
      gripMode: 'open_hand',
      fingerPainCeiling: 3,
      wallWork: { weekdays: [3, 5], typicalStart: '18:00', typicalEnd: '20:00' },
      valgusControl: { required: true, sessionsPerWeek: 2, minHoursFromWall: 6 },
      weakerSide: 'left',
      readinessConfig: { kind: 'seated_mb_throw', metric: 'distance_m', attempts: 3 },
      bestSets: { box_squat: { reps: 2, loadKg: 138.346, rpe: 8.5, at: '2026-08-31' } },
      createdAt: '2026-09-05T12:00:00.000Z',
      updatedAt: '2026-09-05T12:00:00.000Z',
      serverUpdatedAt: new Date('2026-09-05T12:00:00.000Z'),
    });
    const rows = await db
      .select()
      .from(schema.athlete)
      .where(eq(schema.athlete.id, 'athlete_owner'));
    expect(rows[0]?.gripMode).toBe('open_hand');
    expect(rows[0]?.wallWork).toMatchObject({ weekdays: [3, 5] });
    expect(rows[0]?.bestSets).toMatchObject({ box_squat: { reps: 2, rpe: 8.5 } });

    await db.insert(schema.readinessTestSession).values({
      id: 'rt-1',
      athleteId: 'athlete_owner',
      localDate: '2026-10-22',
      kind: 'seated_mb_throw',
      metric: 'distance_m',
      attempts: [6.95, 7.05, 7.15],
      best: 7.15,
      unit: 'm',
      createdAt: '2026-10-22T17:30:00.000Z',
    });
    await db.insert(schema.readinessOutcome).values({
      sessionId: 'session-1',
      localDate: '2026-10-22',
      state: 'neuromuscular_low',
      channels: [{ name: 'autonomic' }, { name: 'neuromuscular' }],
      adjustment: { tierDown: true },
      line: 'Throw 6.4 m. One tier down.',
      houseRuleId: 'house.sc.readiness_gate',
    });
    expect(await db.select().from(schema.readinessTestSession)).toHaveLength(1);
    expect(await db.select().from(schema.readinessOutcome)).toHaveLength(1);
  });

  it('keeps a side on a single-leg jump rep', async () => {
    await db.insert(schema.jumpRep).values([
      {
        id: 'rep-l',
        jumpTestSessionId: 'slt-1',
        attemptIndex: 1,
        heightMm: 455,
        side: 'left',
        createdAt: '2026-10-13T18:05:00.000Z',
      },
      {
        id: 'rep-r',
        jumpTestSessionId: 'slt-1',
        attemptIndex: 2,
        heightMm: 488,
        side: 'right',
        createdAt: '2026-10-13T18:05:00.000Z',
      },
    ]);
    const reps = await db
      .select()
      .from(schema.jumpRep)
      .where(eq(schema.jumpRep.jumpTestSessionId, 'slt-1'));
    expect(reps.map((rep) => rep.side).sort()).toEqual(['left', 'right']);
  });

  it('makes a sync op idempotent by its id', async () => {
    const row = {
      id: 'device-7:412',
      kind: 'setLog.upsert' as const,
      entityId: 'set-1',
      payload: { reps: 5 },
      createdAt: '2026-09-04T18:12:00.000Z',
      receivedAt: new Date('2026-09-04T18:12:01.000Z'),
      origin: 'device' as const,
      deviceId: 'device-7',
    };
    await db.insert(schema.syncOp).values(row);
    await db.insert(schema.syncOp).values(row).onConflictDoNothing();

    const all = await db.select().from(schema.syncOp).where(eq(schema.syncOp.id, 'device-7:412'));
    expect(all).toHaveLength(1);
  });

  it('keeps one set log per set of an exercise', async () => {
    const base = {
      sessionId: 'session-1',
      sessionExerciseId: 'ex-1',
      completedAt: '2026-09-04T18:20:00.000Z',
      createdAt: '2026-09-04T18:20:00.000Z',
    };
    await db.insert(schema.setLog).values({
      ...base,
      id: 'log-1',
      setNumber: 1,
      idempotencyKey: 'ex-1:1',
    });
    await expect(
      db
        .insert(schema.setLog)
        .values({ ...base, id: 'log-2', setNumber: 1, idempotencyKey: 'ex-1:1:again' }),
    ).rejects.toThrow();
  });
});
