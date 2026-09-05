import { describe, expect, it } from 'vitest';
import { kgToLb } from '@vert/engine';
import { prefillOwnerIfEmpty } from '@/app/ownerPrefill';
import { decideGate, type GateAthlete } from '@/app/gateDecision';
import { getAthlete } from '@/data/store/athlete';
import { openMigratedTestDb } from '@/data/testing/testDb';
import type { SqlExecutor } from '@/data/executor';
import { MAX_LIFT_IDS } from './liftIds';
import { OWNER_STEP_ONE, OWNER_STEP_TWO } from './ownerPrefill';

/**
 * `EXPO_PUBLIC_OWNER=1` writes the owner's answers and nothing else.
 *
 * The owner asked for a clean start with their profile already in, which is a
 * different thing from the demo fixture: no program, no sessions, no logs, no
 * tests, no Whoop rows. The two heights stay blank, so the gate still stops at
 * step 2 and nothing is built until the owner taps Build program.
 */

const TODAY = '2026-09-05';
const ZONE = 'America/New_York';

/** Every table that would hold a fixture, so "nothing else" can be asserted. */
const SHOULD_STAY_EMPTY = [
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
  'pain_status',
];

async function count(db: SqlExecutor, table: string): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
  return row?.n ?? 0;
}

describe('the owner prefill', () => {
  it('writes one athlete row and nothing else', async () => {
    const db = await openMigratedTestDb();
    expect(await prefillOwnerIfEmpty(db, TODAY, ZONE, true)).toBe(true);

    expect(await count(db, 'athlete')).toBe(1);
    for (const table of SHOULD_STAY_EMPTY) {
      expect([table, await count(db, table)]).toEqual([table, 0]);
    }
    await db.closeAsync();
  });

  it('writes the answers the owner gave', async () => {
    const db = await openMigratedTestDb();
    await prefillOwnerIfEmpty(db, TODAY, ZONE, true);
    const athlete = await getAthlete(db);

    expect(athlete?.sport).toBe('speed_climbing');
    expect(athlete?.primaryGoal).toBe('vertical_jump');
    expect(athlete?.secondaryGoal).toBe('speed');
    expect(athlete?.level).toBe('advanced');
    expect(athlete?.daysPerWeek).toBe(4);
    expect(athlete?.weekdays).toEqual([1, 2, 3, 5]);
    expect(athlete?.fingerHistory).toBe(true);
    expect(athlete?.gripMode).toBe('open_hand');
    expect(athlete?.fingerPainCeiling).toBe(3);
    expect(athlete?.weakerSide).toBeNull();
    expect(athlete?.wallWork).toMatchObject({
      weekdays: [0, 2, 4],
      typicalStart: '18:00',
      typicalEnd: '20:00',
      fingerLoad: 'hard',
      sameDayGapHours: 6,
    });
    expect(athlete?.valgusControl).toMatchObject({
      required: true,
      sessionsPerWeek: 2,
      minHoursFromWall: 6,
    });
    expect(athlete?.readinessConfig).toMatchObject({ kind: 'seated_mb_throw' });

    const boxSquat = athlete?.workingMax[MAX_LIFT_IDS.boxSquat];
    expect(boxSquat === undefined ? null : Math.round(kgToLb(boxSquat.valueKg))).toBe(320);
    // The weighted pull-up has no entered load, so it has no max yet.
    expect(athlete?.workingMax[MAX_LIFT_IDS.pullUp]).toBeUndefined();
    expect(athlete?.bestSets).toMatchObject({
      [MAX_LIFT_IDS.boxSquat]: { reps: 2, rpe: 8.5, at: '2026-08-31' },
    });
    await db.closeAsync();
  });

  it('leaves the baseline, the goal and the date for the owner to type', async () => {
    const db = await openMigratedTestDb();
    await prefillOwnerIfEmpty(db, TODAY, ZONE, true);
    const athlete = await getAthlete(db);

    expect(athlete?.goalHeightMm).toBeNull();
    expect(athlete?.targetDate).toBeNull();
    expect(athlete?.standingReachMm).toBeNull();
    expect(athlete?.bodyweightKg).toBeNull();
    expect(OWNER_STEP_TWO.baselineIn).toBe('');
    expect(OWNER_STEP_TWO.goalIn).toBe('');
    expect(OWNER_STEP_TWO.targetDate).toBe('');
    await db.closeAsync();
  });

  it('sends the owner to setup step 2, not to Today and not back to step 1', async () => {
    const db = await openMigratedTestDb();
    await prefillOwnerIfEmpty(db, TODAY, ZONE, true);
    const athlete = await getAthlete(db);
    const gateAthlete: GateAthlete = {
      clearance: athlete?.clearance ?? null,
      sport: athlete?.sport ?? null,
      daysPerWeek: athlete?.daysPerWeek ?? null,
      weekdays: athlete?.weekdays ?? [],
      goalHeightMm: athlete?.goalHeightMm ?? null,
      targetDate: athlete?.targetDate ?? null,
    };

    expect(
      decideGate({
        dbStatus: 'ready',
        athleteLoaded: true,
        programLoaded: true,
        athlete: gateAthlete,
        hasProgram: false,
      }),
    ).toBe('setupTwo');
    await db.closeAsync();
  });

  it('does nothing when the flag is off, and never twice', async () => {
    const db = await openMigratedTestDb();
    expect(await prefillOwnerIfEmpty(db, TODAY, ZONE, false)).toBe(false);
    expect(await count(db, 'athlete')).toBe(0);

    expect(await prefillOwnerIfEmpty(db, TODAY, ZONE, true)).toBe(true);
    expect(await prefillOwnerIfEmpty(db, TODAY, ZONE, true)).toBe(false);
    expect(await count(db, 'athlete')).toBe(1);
    await db.closeAsync();
  });

  it('offers the same answers to the forms as it writes to the row', () => {
    // "Use my saved profile" and EXPO_PUBLIC_OWNER=1 are two doors into one
    // set of answers; the day they drift is the day the two paths disagree.
    expect(OWNER_STEP_ONE.sport).toBe('speed_climbing');
    expect(OWNER_STEP_ONE.daysPerWeek).toBe(4);
    expect(OWNER_STEP_ONE.trainingAge).toBe('4plus');
    expect(OWNER_STEP_ONE.wallWorkDays).toEqual([0, 2, 4]);
    expect(OWNER_STEP_TWO.weekdays).toEqual([1, 2, 3, 5]);
    expect(OWNER_STEP_TWO.boxSquatLb).toBe('320');
    expect(OWNER_STEP_TWO.bestSets.boxSquatLb).toEqual({
      reps: '2',
      loadLb: '305',
      rpe: 8.5,
      date: '2026-08-31',
    });
    expect(OWNER_STEP_TWO.inventory.hangboard).toBe(true);
    expect(OWNER_STEP_TWO.inventory.dumbbells).toEqual({ maxLb: 100, incrementLb: 5 });
  });
});
