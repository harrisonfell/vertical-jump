import type {
  SessionPlan,
  SessionRecord,
  SetLog as EngineSetLog,
  WeekPlan,
} from '@vert/engine';
import { buildDefaultFixture, buildOwnerFixture, type OwnerFixture } from '@vert/engine/fixtures';
import { addDays, daysBetween } from '../../lib/localDay';
import type { DayType, Json, Landing, LocalDate, TestStatus } from '../types';
import {
  climberAthleteFields,
  climberReadinessTests,
  climberSingleLegTests,
  isClimberFixture,
} from './fromEngineClimber';
import { rotateWeekday, shiftDay, shiftInstant, shiftJson } from './shift';
import type {
  FixtureData,
  FixtureExercise,
  FixtureJumpTest,
  FixtureSession,
  FixtureReadinessTest,
  FixtureSetLog,
  FixtureWeek,
  FixtureWhoopCycle,
  FixtureWhoopRecovery,
  FixtureWhoopSleep,
  FixtureWhoopWorkout,
} from './types';

/**
 * The engine's owner fixture, reshaped for the store.
 *
 * Either owner fits: `buildDefaultFixture` returns the climbing owner the app
 * boots into, `buildOwnerFixture` the older basketball one. The climbing
 * extras (the readiness stream, the single-leg pairs, the answers behind the
 * `house.sc.*` rules) are read only when the fixture carries them, so the two
 * shapes go through the same conversion.
 *
 * `buildOwnerFixture` runs the real generator over the owner's real answers:
 * advanced, four days a week, program start Mon 7 Sep 2026, target Sun 29 Nov,
 * now week 7 of 12 in the Power block with weeks 1 to 6 logged. Every date is
 * a literal so two runs are byte-identical.
 *
 * Set `EXPO_PUBLIC_FIXTURE_ANCHOR=engine` to write those literal dates. By
 * default the whole fixture slides so its today is the athlete's today, which
 * is what makes Today show a session at all on a machine whose clock is not
 * 22 Oct 2026.
 */

/** The engine's day types, in the words brief section 13 uses. */
const DAY_TYPES: Readonly<Record<string, DayType>> = {
  full_body_strength: 'Full Body Strength',
  lower_strength: 'Lower Strength',
  upper_strength: 'Upper Strength',
  upper_mobility: 'Upper + Mobility',
  power_speed: 'Power + Speed',
  power: 'Power',
  speed: 'Speed',
  recovery_mobility: 'Recovery - Mobility',
};

/** The store has no "none" load mode: a row with no max is an entered one. */
const LOAD_MODES: Readonly<Record<string, NonNullable<FixtureExercise['loadMode']>>> = {
  entered: 'entered',
  epley: 'epley',
  rpe: 'rpe',
  week1: 'week1',
  velocity: 'velocity',
  none: 'entered',
};

/** The onboarding answer, as the years column the store keeps. */
const TRAINING_AGE_YEARS: Readonly<Record<string, number>> = {
  none: 0,
  lt1: 0.5,
  '1to3': 2,
  '4plus': 5,
};

/** Blocks that render as one grouped row and never carry a set log. */
const GROUPED_BLOCKS: ReadonlySet<string> = new Set(['warm_up', 'cool_down']);

function dayTypeOf(value: string): DayType {
  return DAY_TYPES[value] ?? 'Lower Strength';
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function exerciseKeyFor(sessionId: string, block: string, exerciseId: string): string {
  return `${sessionId}::${block}::${exerciseId}`;
}

interface SessionShape {
  readonly session: FixtureSession;
  /** exerciseId to the row key its set logs point at. */
  readonly logTargets: ReadonlyMap<string, string>;
}

function convertSession(
  plan: SessionPlan,
  weekW: number,
  orderIndex: number,
  status: SessionRecord | undefined,
  shift: number,
): SessionShape {
  const exercises: FixtureExercise[] = [];
  const logTargets = new Map<string, string>();
  let order = 0;

  for (const block of plan.blocks) {
    const grouped = GROUPED_BLOCKS.has(block.name);

    for (const row of block.exercises) {
      const key = exerciseKeyFor(plan.id, block.name, row.exerciseId);
      const header = [row.sourceLine, row.capNote].filter(
        (line): line is string => typeof line === 'string' && line !== '',
      );

      exercises.push({
        key,
        exerciseId: row.exerciseId,
        exerciseName: row.name,
        orderIndex: order,
        loadType: row.loadType,
        loadMode: LOAD_MODES[row.loadMode] ?? 'entered',
        block: block.name,
        bothSides: row.bothSides,
        ...(row.rotationNote === undefined ? null : { rotationNote: row.rotationNote }),
        isNewThisWeek: row.rotationNote !== undefined,
        ...(header.length === 0 ? null : { headerNote: header.join(' · ') }),
        ...(row.lastTimeLine === undefined ? null : { lastTimeNote: row.lastTimeLine }),
        restS: row.restS,
        restRule: row.restRule,
        perSet: row.sets as unknown as Json,
      });
      order += 1;

      // A working row always wins the log target; a warm-up row only claims it
      // when nothing else has, so a shared exercise id cannot misfile a set.
      if (!grouped || !logTargets.has(row.exerciseId)) logTargets.set(row.exerciseId, key);
    }
  }

  const session: FixtureSession = {
    key: plan.id,
    weekW,
    scheduledDate: shiftDay(plan.date, shift),
    orderIndex,
    dayType: dayTypeOf(plan.dayType),
    ...(plan.testStatus === undefined ? null : { testStatus: plan.testStatus as TestStatus }),
    isMaximalCns: plan.isMaximalCns,
    ...(status?.sorenessPre === undefined ? null : { sorenessPre: status.sorenessPre }),
    ...(status?.rpe === undefined ? null : { rpe: status.rpe }),
    ...(status?.legsFeel === undefined ? null : { legsFeel: status.legsFeel }),
    ...(status?.markedCompleteAt === undefined
      ? null
      : { markedCompleteAt: shiftInstant(status.markedCompleteAt, shift) }),
    blocksPresent: plan.blocks.map((block) => block.name),
    trimmedExercises: plan.trimmed,
    snapshot: shiftJson(plan, shift),
    exercises,
  };

  return { session, logTargets };
}

function convertWeek(week: WeekPlan, shift: number): FixtureWeek {
  const snapshot = asRecord(week.snapshot);
  const targets = asRecord(snapshot['targets']);
  const highAllowance = finiteNumber(targets['highIntensityAllowance']);
  const extensive = week.sessions.reduce(
    (most, session) => Math.max(most, session.contacts.targetExtensive),
    0,
  );

  return {
    w: week.w,
    windowStart: shiftDay(week.windowStart, shift),
    windowEnd: shiftDay(week.windowEnd, shift),
    kind: week.kind,
    k: finiteNumber(snapshot['k']) ?? 0,
    prescribedCount: week.sessions.length,
    extensiveTarget: extensive,
    ...(highAllowance === undefined ? null : { highContactAllowance: highAllowance }),
    ladderRungs: (targets['ladderRungs'] ?? null) as Json,
    ...(week.repeatOfWeek === undefined ? null : { repeatOfWeek: week.repeatOfWeek }),
    snapshot: shiftJson(week, shift),
  };
}

function convertLog(
  log: EngineSetLog,
  targets: ReadonlyMap<string, ReadonlyMap<string, string>>,
  shift: number,
): FixtureSetLog | null {
  const key = targets.get(log.sessionId)?.get(log.exerciseId);
  if (key === undefined) return null;

  return {
    sessionKey: log.sessionId,
    exerciseKey: key,
    setNumber: log.setNumber,
    ...(log.repsDone === undefined ? null : { repsDone: log.repsDone }),
    ...(log.loadKg === undefined ? null : { loadKg: log.loadKg }),
    ...(log.durationS === undefined ? null : { durationS: log.durationS }),
    ...(log.rpe === undefined ? null : { rpe: log.rpe }),
    ...(log.landing === undefined ? null : { landing: log.landing as Landing }),
    completedAt: shiftInstant(log.completedAt, shift),
    plannedDate: shiftDay(log.plannedDate, shift),
    entrySource: 'typed',
  };
}

function convertTests(owner: OwnerFixture, shift: number): FixtureJumpTest[] {
  return owner.tests.map((test) => ({
    localDate: shiftDay(test.date, shift),
    performedAt: shiftInstant(test.createdAt, shift),
    instrument: test.instrument,
    mode: test.mode,
    isBaseline: test.isBaseline,
    canonical: test.canonical,
    ...(test.bodyweightKg === undefined ? null : { bodyweightKg: test.bodyweightKg }),
    attempts: test.reps.map((rep) => ({
      attemptIndex: rep.repNumber,
      heightMm: rep.heightMm,
      ...(rep.gctMs === undefined ? null : { gctMs: rep.gctMs }),
      flagged: rep.flagged,
    })),
  }));
}

interface WhoopBuckets {
  readonly cycles: FixtureWhoopCycle[];
  readonly recoveries: FixtureWhoopRecovery[];
  readonly sleeps: FixtureWhoopSleep[];
  readonly workouts: FixtureWhoopWorkout[];
}

function convertWhoop(owner: OwnerFixture, shift: number): WhoopBuckets {
  const cycles = owner.whoop.cycles.map<FixtureWhoopCycle>((row) => ({
    id: `whoop_cycle_${row.id}`,
    localDate: shiftDay(row.localDay, shift),
    scoreState: row.score_state,
    startAt: shiftInstant(row.start, shift),
    endAt: shiftInstant(row.end, shift),
    ...(row.score === undefined ? null : { strain: row.score.strain }),
    raw: row as unknown as Json,
  }));

  const recoveries = owner.whoop.recoveries.map<FixtureWhoopRecovery>((row) => ({
    id: `whoop_recovery_${row.cycle_id}`,
    localDate: shiftDay(row.localDay, shift),
    scoreState: row.score_state,
    userCalibrating: row.score?.user_calibrating ?? false,
    ...(row.score === undefined
      ? null
      : {
          recoveryScore: row.score.recovery_score,
          restingHeartRate: row.score.resting_heart_rate,
          hrvRmssdMilli: row.score.hrv_rmssd_milli,
        }),
    raw: row as unknown as Json,
  }));

  const sleeps = owner.whoop.sleeps.map<FixtureWhoopSleep>((row) => ({
    id: `whoop_sleep_${row.id}`,
    localDate: shiftDay(row.localDay, shift),
    scoreState: row.score_state,
    startAt: shiftInstant(row.start, shift),
    endAt: shiftInstant(row.end, shift),
    ...(row.score === undefined
      ? null
      : {
          sleepPerformancePercentage: row.score.sleep_performance_percentage,
          totalInBedTimeMilli: row.score.total_in_bed_time_milli,
        }),
    raw: row as unknown as Json,
  }));

  const workouts = owner.whoop.workouts.map<FixtureWhoopWorkout>((row) => ({
    id: `whoop_workout_${row.id}`,
    localDate: shiftDay(row.localDay, shift),
    scoreState: row.score_state,
    sportName: 'Weightlifting',
    startAt: shiftInstant(row.start, shift),
    endAt: shiftInstant(row.end, shift),
    ...(row.score === undefined
      ? null
      : {
          strain: row.score.strain,
          averageHeartRate: row.score.average_heart_rate,
          maxHeartRate: row.score.max_heart_rate,
        }),
    raw: row as unknown as Json,
  }));

  return { cycles, recoveries, sleeps, workouts };
}

/** Whole days the fixture moves so its today is the athlete's today. */
export function fixtureShiftDays(
  owner: OwnerFixture,
  today: LocalDate,
  anchor: string | undefined = process.env.EXPO_PUBLIC_FIXTURE_ANCHOR,
): number {
  if (anchor === 'engine') return 0;
  return daysBetween(owner.today, today);
}

/** The engine's owner fixture, in the shape the seeder writes. */
export function fromEngineFixture(
  owner: OwnerFixture,
  today: LocalDate,
  timezone: string,
): FixtureData {
  const shift = fixtureShiftDays(owner, today);
  const { athlete, skeleton } = owner;

  const weeks: FixtureWeek[] = [];
  const sessions: FixtureSession[] = [];
  const targets = new Map<string, ReadonlyMap<string, string>>();

  const statusById = new Map<string, SessionRecord>();
  for (const status of owner.sessions) statusById.set(status.sessionId, status);

  for (const week of owner.weeks) {
    weeks.push(convertWeek(week, shift));
    week.sessions.forEach((plan, index) => {
      const shaped = convertSession(plan, week.w, index, statusById.get(plan.id), shift);
      sessions.push(shaped.session);
      targets.set(plan.id, shaped.logTargets);
    });
  }

  const setLogs: FixtureSetLog[] = [];
  for (const log of owner.setLogs) {
    const converted = convertLog(log, targets, shift);
    if (converted !== null) setLogs.push(converted);
  }

  const whoop = convertWhoop(owner, shift);
  const climbing = isClimberFixture(owner);
  const readinessTests: FixtureReadinessTest[] = climbing
    ? climberReadinessTests(owner, shift)
    : [];
  const jumpTests = [
    ...convertTests(owner, shift),
    ...(climbing ? climberSingleLegTests(owner, shift) : []),
  ];
  const lastWeek = owner.weeks[owner.weeks.length - 1];
  const rulesetVersion = asRecord(lastWeek?.snapshot)['rulesetVersion'];

  const workingMax: Record<string, unknown> = {};
  for (const max of athlete.workingMaxes) {
    workingMax[max.lift] = {
      exerciseId: max.lift,
      valueKg: max.valueKg,
      source: max.source,
      confidence: max.confidence,
      frozenAt: shiftInstant(max.frozenAt, shift),
      lastRaiseAt: max.lastRaiseAt === undefined ? null : shiftInstant(max.lastRaiseAt, shift),
    };
  }

  return {
    athlete: {
      primaryGoal: athlete.primaryGoal,
      sport: athlete.sport,
      trainingAgeYears: TRAINING_AGE_YEARS[athlete.trainingAge] ?? 0,
      level: athlete.level,
      daysPerWeek: athlete.daysPerWeek,
      weekdays: athlete.weekdays.map((weekday) => rotateWeekday(weekday, shift)),
      inventory: athlete.inventory as unknown as Json,
      clearance: shiftJson(athlete.clearance, shift),
      weightRoomAccess: athlete.inventory.weightRoomAccess,
      ...(athlete.bodyweightKg === null ? null : { bodyweightKg: athlete.bodyweightKg }),
      goalHeightMm: athlete.goalHeightMm,
      targetDate: shiftDay(athlete.targetDate, shift),
      ...(athlete.standingReachMm === null ? null : { standingReachMm: athlete.standingReachMm }),
      timezone,
      rolloverHour: athlete.rolloverHour,
      inSeason: athlete.inSeason,
      workingMax: workingMax as Json,
      ...(climbing ? climberAthleteFields(owner, shift) : null),
    },
    program: {
      rulesetVersion: typeof rulesetVersion === 'string' ? rulesetVersion : 'ruleset.v1',
      seed: String(owner.seed),
      startDate: shiftDay(skeleton.programStart, shift),
      endDate: shiftDay(addDays(skeleton.programStart, skeleton.W * 7 - 1), shift),
      snapshot: shiftJson(skeleton, shift),
      weekLayout: shiftJson(
        skeleton.weeks.map((week) => ({
          w: week.w,
          kind: week.kind,
          blockType: week.blockType,
          windowStart: week.windowStart,
          windowEnd: week.windowEnd,
          k: week.k,
          notes: week.notes,
        })),
        shift,
      ),
      blocks: skeleton.blocks.map((block, index) => ({
        type: block.type,
        orderIndex: index,
        weekStart: block.weekFrom,
        weekEnd: block.weekTo,
      })),
    },
    weeks,
    sessions,
    setLogs,
    jumpTests,
    readinessTests,
    // A connected row behind the mirrors: ninety days of seeded recovery,
    // sleep and strain that the strip refuses to show because nothing says the
    // athlete ever connected is a fixture that does not exercise the screen.
    whoopConnection: {
      status: 'connected',
      connectedAt: `${whoop.recoveries[0]?.localDate ?? today}T09:00:00.000Z`,
      lastSyncAt: `${today}T06:40:00.000Z`,
      whoopUserId: 'fixture-whoop-user',
      scopes: 'read:recovery read:sleep read:cycles read:workout',
      backfillDaysDone: whoop.recoveries.length,
      backfillDaysTotal: whoop.recoveries.length,
    },
    whoopCycles: whoop.cycles,
    whoopRecoveries: whoop.recoveries,
    whoopSleeps: whoop.sleeps,
    whoopWorkouts: whoop.workouts,
  };
}

/**
 * Builds the fixture the app boots into and converts it. Deterministic for a
 * given today.
 *
 * `variant` is the app's own EXPO_PUBLIC_FIXTURE value: the owner trains for
 * speed climbing, so "1" is the climber and "basketball" keeps the older
 * fixture the invariant tests and the earlier screenshots read.
 */
export function buildEngineFixture(
  today: LocalDate,
  timezone: string,
  variant: 'climber' | 'basketball' = 'climber',
): FixtureData {
  const owner = variant === 'basketball' ? buildOwnerFixture() : buildDefaultFixture();
  return fromEngineFixture(owner, today, timezone);
}
