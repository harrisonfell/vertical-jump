import { describe, expect, it } from 'vitest';
import { buildClimberFixture, buildOwnerFixture } from '@vert/engine/fixtures';
import { getAthlete } from '../store/athlete';
import { getCurrentProgram, listWeeks } from '../store/program';
import { listSessionsByWeek } from '../store/sessions';
import { listJumpTests } from '../store/jumpTests';
import {
  listReadinessTests,
  listSingleLegTests,
  readWeakerSide,
  SINGLE_LEG_MODE,
} from '../store/readiness';
import { listSessionExercises } from '../store/sessions';
import { openMigratedTestDb } from '../testing/testDb';
import { buildEngineFixture, fromEngineFixture } from './fromEngine';
import { isClimberFixture } from './fromEngineClimber';
import { applyFixture, fixtureMode } from './seed';
import { readBestSets, readSessionWindow, readWallWork } from '@/lib/engineAthlete';
import { upperPowerWindowLine } from '@/features/plan/climbLines';

/**
 * The climbing owner, written through the real repositories.
 *
 * The owner trains for speed climbing, so EXPO_PUBLIC_FIXTURE=1 seeds them and
 * "basketball" keeps the older fixture. What is asserted here is what a screen
 * would otherwise get wrong quietly: the sport on the athlete row, the gate's
 * configuration and its stream, the single-leg pairs that must never join the
 * jump stream, and the upper power session on the current week's Tuesday.
 */

const ZONE = 'America/New_York';
/** The engine fixture's own today: week 7, the Wednesday test day. */
const ENGINE_TODAY = '2026-10-21';
const CURRENT_WEEK = 7;

describe('the fixture the app boots into', () => {
  it('reads the four states of EXPO_PUBLIC_FIXTURE', () => {
    expect(fixtureMode('1')).toBe('seed');
    expect(fixtureMode('basketball')).toBe('basketball');
    expect(fixtureMode('empty')).toBe('empty');
    expect(fixtureMode(undefined)).toBe('off');
  });

  it('tells the two owner shapes apart by what they carry', () => {
    expect(isClimberFixture(buildClimberFixture())).toBe(true);
    expect(isClimberFixture(buildOwnerFixture())).toBe(false);
  });

  it('builds the climber by default and the basketball owner on request', () => {
    const climber = buildEngineFixture(ENGINE_TODAY, ZONE);
    expect(climber.athlete.sport).toBe('speed_climbing');
    expect(climber.readinessTests?.length ?? 0).toBeGreaterThan(0);

    const basketball = buildEngineFixture(ENGINE_TODAY, ZONE, 'basketball');
    expect(basketball.athlete.sport).toBe('basketball');
    // No gate, no single-leg pairs: this athlete was never asked.
    expect(basketball.readinessTests ?? []).toEqual([]);
    expect(basketball.athlete.readinessConfig).toBeUndefined();
  });
});

describe('the climber, seeded through the repositories', () => {
  it('writes the sport, the grip, the wall days and the gate onto the athlete', async () => {
    const db = await openMigratedTestDb();
    await applyFixture(db, fromEngineFixture(buildClimberFixture(), ENGINE_TODAY, ZONE));

    const athlete = await getAthlete(db);
    expect(athlete?.sport).toBe('speed_climbing');
    expect(athlete?.secondaryGoal).toBe('speed');
    expect(athlete?.fingerHistory).toBe(true);
    expect(athlete?.gripMode).toBe('open_hand');
    expect(athlete?.fingerPainCeiling).toBe(3);
    expect(athlete?.weakerSide).toBe('left');
    expect(athlete?.wallWork).toMatchObject({
      weekdays: [0, 2, 4],
      typicalStart: '18:00',
      typicalEnd: '20:00',
      // The owner's two answers: the wall IS a hard finger session, and gym
      // pulling may share a day with it six hours apart
      // (`house.sc.hard_finger_spacing`).
      fingerLoad: 'hard',
      sameDayGapHours: 6,
    });
    expect(athlete?.sessionWindow).toMatchObject({ start: '08:00', end: '10:00' });
    // R73's own source, typed in setup step two: two at 305 lb at RPE 8.5.
    expect(readBestSets(athlete?.bestSets ?? null)['box_squat']).toMatchObject({
      reps: 2,
      rpe: 8.5,
    });
    expect(athlete?.valgusControl).toMatchObject({ required: true, sessionsPerWeek: 2 });
    expect(athlete?.readinessConfig).toMatchObject({
      kind: 'seated_mb_throw',
      metric: 'distance_m',
      attempts: 3,
    });
    // The hangboard and the box squat box, which the two main lifts need.
    expect(athlete?.inventory).toMatchObject({ hangboard: true, boxSquatBox: true });

    await db.closeAsync();
  });

  it('seeds the gate stream with today at the end of it', async () => {
    const db = await openMigratedTestDb();
    await applyFixture(db, fromEngineFixture(buildClimberFixture(), ENGINE_TODAY, ZONE));

    const tests = await listReadinessTests(db, { kind: 'seated_mb_throw' });
    expect(tests.length).toBeGreaterThanOrEqual(10);
    const today = tests[tests.length - 1];
    expect(today?.localDate).toBe(ENGINE_TODAY);
    expect(today?.best).toBeCloseTo(7.15, 5);
    expect(today?.unit).toBe('m');
    expect(today?.attempts).toHaveLength(3);

    // Every prior day sits behind today, which is what the rolling median is
    // taken over (`house.sc.readiness_gate`).
    const history = await listReadinessTests(db, {
      kind: 'seated_mb_throw',
      onOrBefore: '2026-10-20',
    });
    expect(history).toHaveLength(tests.length - 1);

    await db.closeAsync();
  });

  it('keeps the single-leg pairs out of the jump stream', async () => {
    const db = await openMigratedTestDb();
    await applyFixture(db, fromEngineFixture(buildClimberFixture(), ENGINE_TODAY, ZONE));

    const pairs = await listSingleLegTests(db);
    expect(pairs).toHaveLength(2);
    for (const pair of pairs) expect(pair.rightIn).toBeGreaterThan(pair.leftIn);
    expect(pairs[pairs.length - 1]?.weakerSide).toBe('left');
    expect(await readWeakerSide(db, null)).toBe('left');

    // The canonical stream is untouched by them: they are their own mode, and
    // no single-leg row is ever canonical.
    const canonical = await listJumpTests(db, {
      instrument: 'ovr_jump_regular',
      canonicalOnly: true,
    });
    expect(canonical.length).toBeGreaterThan(0);
    for (const test of canonical) expect(test.mode).not.toBe(SINGLE_LEG_MODE);

    await db.closeAsync();
  });

  it('puts an upper power session on the current week Tuesday', async () => {
    const db = await openMigratedTestDb();
    await applyFixture(db, fromEngineFixture(buildClimberFixture(), ENGINE_TODAY, ZONE));

    const program = await getCurrentProgram(db);
    const weeks = await listWeeks(db, program?.id ?? '');
    const week = weeks.find((entry) => entry.w === CURRENT_WEEK);
    expect(week).toBeDefined();

    const sessions = await listSessionsByWeek(db, week?.id ?? '', ENGINE_TODAY);
    // Mon, Tue, Wed, Fri: the owner's four days.
    expect(sessions).toHaveLength(4);
    const tuesday = sessions.find((session) => session.scheduledDate === '2026-10-20');
    expect(tuesday?.dayType).toBe('Upper Strength');

    const snapshot = tuesday?.snapshot as { sessionIntent?: string; weekday?: number } | null;
    // House `house.sc.upper_power_day`: the Upper Strength day runs at upper
    // power for this sport, not at the fixed hypertrophy loads of R135.
    expect(snapshot?.sessionIntent).toBe('upper_power');

    // The line the app says for itself: the upper-power day landed on a
    // climbing day, and here are the two windows that let it
    // (`house.sc.sport_requirements`).
    const athlete = await getAthlete(db);
    expect(
      upperPowerWindowLine({
        wallWork: readWallWork(athlete?.wallWork ?? null),
        sessionWindow: readSessionWindow(athlete?.sessionWindow ?? null),
        weekday: snapshot?.weekday ?? -1,
        sessionIntent: snapshot?.sessionIntent ?? null,
      }),
    ).toBe(
      'Upper power on a climbing day: gym 08:00 to 10:00, wall 18:00 to 20:00, kept 6 h apart.',
    );

    await db.closeAsync();
  });

  it('puts a sprint on the Wednesday, as a distance row at R104 rest', async () => {
    const db = await openMigratedTestDb();
    await applyFixture(db, fromEngineFixture(buildClimberFixture(), ENGINE_TODAY, ZONE));

    const program = await getCurrentProgram(db);
    const weeks = await listWeeks(db, program?.id ?? '');
    const week = weeks.find((entry) => entry.w === CURRENT_WEEK);
    const sessions = await listSessionsByWeek(db, week?.id ?? '', ENGINE_TODAY);
    const wednesday = sessions.find((session) => session.scheduledDate === ENGINE_TODAY);
    expect(wednesday?.dayType).toBe('Power + Speed');

    const rows = await listSessionExercises(db, wednesday?.id ?? '');
    // The row the day carries is the 10 m acceleration (R102, R113): the
    // sprint ids are `accel_sprint_10m` and `sprint_<distance>`, so match the
    // word rather than the prefix.
    const sprint = rows.find((row) => row.exerciseId.includes('sprint'));
    expect(sprint).toBeDefined();

    // A sprint is a distance row: every set carries a distance and a display
    // load in metres rather than a load in pounds (R102 to R104).
    const sets = sprint?.perSet as { distanceM?: number; displayLoad?: string; restS?: number }[];
    expect(sets.length).toBeGreaterThan(0);
    for (const set of sets) {
      expect(typeof set.distanceM).toBe('number');
      expect(set.displayLoad).toMatch(/^\d+ m$/);
    }
    // R104: an acceleration or max-velocity sprint rests at least two minutes.
    expect(sprint?.restS ?? 0).toBeGreaterThanOrEqual(120);

    await db.closeAsync();
  });
});
