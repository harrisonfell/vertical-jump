import type { SqlExecutor } from '../executor';
import type { LocalDate } from '../types';
import { isAthleteEmpty, upsertAthlete } from '../store/athlete';
import { createProgram, upsertWeek } from '../store/program';
import { createSession, markSessionComplete, patchSession } from '../store/sessions';
import { createJumpTest } from '../store/jumpTests';
import { createReadinessTest } from '../store/readiness';
import { KV_KEYS, kvSet } from '../store/kv';
import { listSessionExercises } from '../store/sessions';
import { logSet } from '../store/setLogs';
import {
  setWhoopConnection,
  upsertWhoopCycle,
  upsertWhoopRecovery,
  upsertWhoopSleep,
  upsertWhoopWorkout,
} from '../store/whoop';
import { nowIso } from '../store/rows';
import { buildEngineFixture } from './fromEngine';
import { buildPlaceholderFixture } from './placeholder';
import { isFixtureData, type FixtureData } from './types';

/**
 * Fixture seeding.
 *
 * EXPO_PUBLIC_FIXTURE=1 seeds the owner on first open, "basketball" seeds the
 * older basketball fixture the invariant tests and the earlier screenshots
 * read, "empty" seeds nothing, and anything else leaves the store alone.
 * Seeding only ever happens when the athlete table is empty, so a real
 * database is never overwritten.
 */

export type FixtureMode = 'off' | 'seed' | 'basketball' | 'empty';

export function fixtureMode(value: string | undefined = process.env.EXPO_PUBLIC_FIXTURE): FixtureMode {
  if (value === '1') return 'seed';
  if (value === 'basketball') return 'basketball';
  if (value === 'empty') return 'empty';
  return 'off';
}

/**
 * The owner fixture, built through @vert/engine and reshaped for the store.
 *
 * The conversion lives in `fromEngine.ts` and the call is guarded: if the
 * engine throws (a shape change, a failed invariant) the placeholder keeps the
 * screens honest rather than leaving the app with nothing to render.
 */
export async function loadEngineFixture(
  today: LocalDate,
  timezone: string,
  mode: FixtureMode = 'seed',
): Promise<FixtureData | null> {
  try {
    const built = buildEngineFixture(today, timezone, mode === 'basketball' ? 'basketball' : 'climber');
    return isFixtureData(built) ? built : null;
  } catch {
    return null;
  }
}

export async function seedIfEmpty(
  db: SqlExecutor,
  today: LocalDate,
  timezone: string,
  mode: FixtureMode = fixtureMode(),
): Promise<boolean> {
  if (mode !== 'seed' && mode !== 'basketball') return false;
  if (!(await isAthleteEmpty(db))) return false;
  const fixture =
    (await loadEngineFixture(today, timezone, mode)) ?? buildPlaceholderFixture(today, timezone);
  await applyFixture(db, fixture);
  return true;
}

/** Writes a fixture through the repositories, so nothing bypasses their rules. */
export async function applyFixture(db: SqlExecutor, fixture: FixtureData): Promise<void> {
  await upsertAthlete(db, {
    primaryGoal: fixture.athlete.primaryGoal ?? null,
    sport: fixture.athlete.sport ?? null,
    trainingAgeYears: fixture.athlete.trainingAgeYears ?? null,
    level: fixture.athlete.level ?? null,
    daysPerWeek: fixture.athlete.daysPerWeek ?? null,
    weekdays: fixture.athlete.weekdays ?? [],
    inventory: fixture.athlete.inventory ?? null,
    clearance: fixture.athlete.clearance ?? null,
    weightRoomAccess: fixture.athlete.weightRoomAccess ?? false,
    bodyweightKg: fixture.athlete.bodyweightKg ?? null,
    goalHeightMm: fixture.athlete.goalHeightMm ?? null,
    targetDate: fixture.athlete.targetDate ?? null,
    standingReachMm: fixture.athlete.standingReachMm ?? null,
    timezone: fixture.athlete.timezone,
    rolloverHour: fixture.athlete.rolloverHour ?? 0,
    inSeason: fixture.athlete.inSeason ?? false,
    workingMax: (fixture.athlete.workingMax ?? {}) as Record<string, never>,
    // The climbing answers. A fixture that never carries them writes the same
    // nulls an athlete who was never asked already has.
    secondaryGoal: fixture.athlete.secondaryGoal ?? null,
    fingerHistory: fixture.athlete.fingerHistory ?? false,
    gripMode: fixture.athlete.gripMode ?? null,
    fingerPainCeiling: fixture.athlete.fingerPainCeiling ?? null,
    wallWork: fixture.athlete.wallWork ?? null,
    sessionWindow: fixture.athlete.sessionWindow ?? null,
    valgusControl: fixture.athlete.valgusControl ?? null,
    weakerSide: fixture.athlete.weakerSide ?? null,
    readinessConfig: fixture.athlete.readinessConfig ?? null,
    bestSets: fixture.athlete.bestSets ?? null,
  });

  const { program, version } = await createProgram(db, {
    rulesetVersion: fixture.program.rulesetVersion,
    seed: fixture.program.seed,
    startDate: fixture.program.startDate,
    endDate: fixture.program.endDate,
    snapshot: fixture.program.snapshot,
    weekLayout: fixture.program.weekLayout,
    reason: 'fixture',
    blocks: fixture.program.blocks,
  });

  const weekIds = new Map<number, string>();
  for (const week of fixture.weeks) {
    const saved = await upsertWeek(db, {
      programId: program.id,
      programVersionId: version.id,
      w: week.w,
      windowStart: week.windowStart,
      windowEnd: week.windowEnd,
      kind: week.kind,
      k: week.k ?? null,
      prescribedCount: week.prescribedCount ?? 0,
      extensiveTarget: week.extensiveTarget ?? null,
      highContactAllowance: week.highContactAllowance ?? null,
      ladderRungs: week.ladderRungs ?? null,
      repeatOfWeek: week.repeatOfWeek ?? null,
      snapshot: week.snapshot ?? null,
      generatedAt: nowIso(),
      generatedBy: 'fixture',
    });
    weekIds.set(week.w, saved.id);
  }

  const sessionIds = new Map<string, string>();
  const exerciseIds = new Map<string, string>();

  for (const session of fixture.sessions) {
    const weekId = weekIds.get(session.weekW);
    if (weekId === undefined) continue;
    const sessionId = await createSession(db, {
      programId: program.id,
      weekId,
      scheduledDate: session.scheduledDate,
      orderIndex: session.orderIndex,
      dayType: session.dayType,
      testStatus: session.testStatus ?? null,
      isMaximalCns: session.isMaximalCns ?? false,
      blocksPresent: session.blocksPresent ?? null,
      trimmedExercises: session.trimmedExercises ?? null,
      snapshot: session.snapshot ?? null,
      exercises: session.exercises.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        exerciseName: exercise.exerciseName,
        orderIndex: exercise.orderIndex,
        loadType: exercise.loadType,
        loadMode: exercise.loadMode ?? 'entered',
        block: exercise.block ?? null,
        bothSides: exercise.bothSides ?? false,
        rotationNote: exercise.rotationNote ?? null,
        isNewThisWeek: exercise.isNewThisWeek ?? false,
        headerNote: exercise.headerNote ?? null,
        lastTimeNote: exercise.lastTimeNote ?? null,
        restS: exercise.restS ?? null,
        restRule: exercise.restRule ?? null,
        perSet: exercise.perSet,
      })),
    });
    sessionIds.set(session.key, sessionId);

    const saved = await listSessionExercises(db, sessionId);
    for (const exercise of session.exercises) {
      const match = saved.find((item) => item.orderIndex === exercise.orderIndex);
      if (match !== undefined) exerciseIds.set(exercise.key, match.id);
    }

    if (
      session.sorenessPre !== undefined ||
      session.rpe !== undefined ||
      session.notes !== undefined ||
      session.legsFeel !== undefined
    ) {
      await patchSession(db, sessionId, {
        sorenessPre: session.sorenessPre ?? null,
        rpe: session.rpe ?? null,
        legsFeel: session.legsFeel ?? null,
        notes: session.notes ?? null,
      });
    }
  }

  for (const log of fixture.setLogs) {
    const sessionId = sessionIds.get(log.sessionKey);
    const sessionExerciseId = exerciseIds.get(log.exerciseKey);
    if (sessionId === undefined || sessionExerciseId === undefined) continue;
    await logSet(db, {
      sessionId,
      sessionExerciseId,
      setNumber: log.setNumber,
      repsDone: log.repsDone ?? null,
      loadKg: log.loadKg ?? null,
      durationS: log.durationS ?? null,
      distanceM: log.distanceM ?? null,
      rpe: log.rpe ?? null,
      landing: log.landing ?? null,
      completedAt: log.completedAt,
      plannedDate: log.plannedDate ?? null,
      entrySource: log.entrySource ?? 'typed',
    });
  }

  // The finish mark is an event, and it has to land after the last set log.
  for (const session of fixture.sessions) {
    const sessionId = sessionIds.get(session.key);
    if (sessionId === undefined || session.markedCompleteAt === undefined) continue;
    await markSessionComplete(db, sessionId, session.markedCompleteAt);
  }

  for (const test of fixture.readinessTests ?? []) {
    await createReadinessTest(db, {
      localDate: test.localDate,
      kind: test.kind,
      metric: test.metric,
      attempts: test.attempts,
      best: test.best,
      unit: test.unit,
      whoopRecoverySnapshot: test.whoopRecoverySnapshot ?? null,
      ...(test.createdAt === undefined ? null : { createdAt: test.createdAt }),
    });
  }

  for (const test of fixture.jumpTests) {
    await createJumpTest(db, {
      localDate: test.localDate,
      performedAt: test.performedAt,
      instrument: test.instrument,
      mode: test.mode,
      isBaseline: test.isBaseline ?? false,
      canonical: test.canonical ?? true,
      bodyweightKg: test.bodyweightKg ?? null,
      notes: test.notes ?? null,
      attempts: test.attempts,
    });
  }

  // Before the mirrors, because the strip reads the connection first: ninety
  // days of seeded recovery behind a disconnected row is a screen that says
  // "Whoop not connected" while holding every number it claims not to have.
  if (fixture.whoopConnection !== undefined) {
    const connection = fixture.whoopConnection;
    await setWhoopConnection(db, {
      status: connection.status,
      connectedAt: connection.connectedAt,
      lastSyncAt: connection.lastSyncAt,
      whoopUserId: connection.whoopUserId ?? null,
      scopes: connection.scopes ?? null,
      backfillDaysDone: connection.backfillDaysDone ?? 0,
      backfillDaysTotal: connection.backfillDaysTotal ?? 0,
    });
  }

  for (const cycle of fixture.whoopCycles ?? []) {
    await upsertWhoopCycle(db, {
      id: cycle.id,
      scoreState: cycle.scoreState,
      localDate: cycle.localDate,
      startAt: cycle.startAt,
      endAt: cycle.endAt ?? null,
      strain: cycle.strain ?? null,
      raw: cycle.raw,
    });
  }

  for (const recovery of fixture.whoopRecoveries ?? []) {
    await upsertWhoopRecovery(db, {
      id: recovery.id,
      scoreState: recovery.scoreState,
      localDate: recovery.localDate,
      userCalibrating: recovery.userCalibrating ?? false,
      recoveryScore: recovery.recoveryScore ?? null,
      restingHeartRate: recovery.restingHeartRate ?? null,
      hrvRmssdMilli: recovery.hrvRmssdMilli ?? null,
      raw: recovery.raw,
    });
  }

  for (const sleep of fixture.whoopSleeps ?? []) {
    await upsertWhoopSleep(db, {
      id: sleep.id,
      scoreState: sleep.scoreState,
      localDate: sleep.localDate,
      startAt: sleep.startAt,
      endAt: sleep.endAt,
      sleepPerformancePercentage: sleep.sleepPerformancePercentage ?? null,
      totalInBedTimeMilli: sleep.totalInBedTimeMilli ?? null,
      raw: sleep.raw,
    });
  }

  for (const workout of fixture.whoopWorkouts ?? []) {
    await upsertWhoopWorkout(db, {
      id: workout.id,
      scoreState: workout.scoreState,
      localDate: workout.localDate,
      sportName: workout.sportName ?? null,
      startAt: workout.startAt,
      endAt: workout.endAt ?? null,
      strain: workout.strain ?? null,
      averageHeartRate: workout.averageHeartRate ?? null,
      maxHeartRate: workout.maxHeartRate ?? null,
      raw: workout.raw,
    });
  }

  for (const [key, value] of Object.entries(fixture.kv ?? {})) {
    await kvSet(db, key, value);
  }

  await kvSet(db, KV_KEYS.fixtureSeededAt, nowIso());
}
