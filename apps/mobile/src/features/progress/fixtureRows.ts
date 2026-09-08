import { RULESET_V1 } from '@vert/engine';
import { inToMm, lbToKg } from '@vert/engine/units';
import type {
  Athlete,
  JumpRep,
  JumpTestWithReps,
  LiftSetRow,
  Program,
  ReadinessTestSession,
  SessionWithStatus,
  SingleLegTest,
  Week,
  WhoopRecovery,
} from '@/data';
import { addDays } from '../../ui/charts/scale';
import type { ProgressSources } from './types';

/**
 * Store-shaped rows that match the owner fixture's own numbers.
 *
 * The engine fixture is engine-native; Progress reads the store. Rather than
 * running the whole conversion inside a unit test, these builders reproduce
 * the same program (Mon 7 Sep 2026 to Sun 29 Nov 2026, goal 36 in, baseline
 * 29.4 in, six Thursday tests rising to 32.5 in) in the shape the selectors
 * actually see, so a test can move one number and read the consequence.
 */

export const FIXTURE_START = '2026-09-07';
export const FIXTURE_TARGET = '2026-11-29';
export const FIXTURE_TODAY = '2026-10-22';
export const FIXTURE_HEIGHTS_IN = [29.4, 30.1, 30.6, 31.3, 31.7, 32.5];

const NOW = '2026-10-22T18:05:00.000Z';

export function makeRep(index: number, heightMm: number, flagged = false): JumpRep {
  return {
    id: `rep-${index}-${Math.round(heightMm)}`,
    jumpTestSessionId: 'test',
    attemptIndex: index,
    heightMm,
    gctMs: null,
    rsiCalc: null,
    rsiDevice: null,
    flagged,
    rejectReason: null,
    entrySource: 'typed',
    importBatchId: null,
    createdAt: NOW,
  };
}

export interface TestOptions {
  readonly id: string;
  readonly date: string;
  readonly heightIn: number;
  readonly isBaseline?: boolean;
  readonly canonical?: boolean;
  readonly isPr?: boolean;
  readonly instrument?: JumpTestWithReps['instrument'];
  readonly mode?: string;
  readonly connectVersion?: string | null;
  readonly bodyweightKg?: number | null;
}

export function makeTest(options: TestOptions): JumpTestWithReps {
  const best = inToMm(options.heightIn);
  const reps = [makeRep(1, best - 8), makeRep(2, best), makeRep(3, best - 4)];
  const heights = reps.filter((rep) => !rep.flagged).map((rep) => rep.heightMm ?? 0);
  return {
    id: options.id,
    athleteId: 'owner',
    sessionId: null,
    localDate: options.date,
    performedAt: `${options.date}T18:05:00.000Z`,
    instrument: options.instrument ?? 'ovr_jump_regular',
    mode: options.mode ?? 'Regular',
    unitPreference: 'in',
    boxHeightMm: null,
    deviceFirmware: '2.4.1',
    connectVersion: options.connectVersion === undefined ? '3.2.0' : options.connectVersion,
    isBaseline: options.isBaseline ?? false,
    canonical: options.canonical ?? true,
    scheduled: true,
    bodyweightKg: options.bodyweightKg === undefined ? lbToKg(181) : options.bodyweightKg,
    whoopSnapshot: null,
    notes: null,
    importBatchId: null,
    createdAt: `${options.date}T18:05:00.000Z`,
    updatedAt: `${options.date}T18:05:00.000Z`,
    reps,
    bestHeightMm: Math.max(...heights),
    spreadMm: Math.max(...heights) - Math.min(...heights),
    isPr: options.isPr ?? false,
  };
}

/** The six canonical Thursday tests, the first of them the baseline. */
export function fixtureTests(heights: readonly number[] = FIXTURE_HEIGHTS_IN): JumpTestWithReps[] {
  return heights.map((heightIn, index) =>
    makeTest({
      id: `test-w${index + 1}`,
      date: addDays(FIXTURE_START, index * 7 + 3),
      heightIn,
      isBaseline: index === 0,
      isPr: index === heights.length - 1,
    }),
  );
}

export function fixtureAthlete(overrides: Partial<Athlete> = {}): Athlete {
  return {
    id: 'owner',
    primaryGoal: 'vertical_jump',
    sport: 'basketball',
    trainingAgeYears: 5,
    level: 'advanced',
    daysPerWeek: 4,
    weekdays: [1, 2, 4, 6],
    isAdult: true,
    clearance: null,
    inventory: null,
    weightRoomAccess: true,
    bodyweightKg: lbToKg(181),
    workingMax: {},
    inSeason: false,
    readinessPassedAt: '2026-09-01',
    standingReachMm: null,
    goalHeightMm: inToMm(36),
    targetDate: FIXTURE_TARGET,
    timezone: 'America/New_York',
    rolloverHour: 0,
    testConditionsNote: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function fixtureProgram(overrides: Partial<Program> = {}): Program {
  return {
    id: 'program-1',
    athleteId: 'owner',
    macroIndex: 1,
    parentProgramId: null,
    rulesetVersion: 'v1',
    seed: '20260907',
    startDate: FIXTURE_START,
    endDate: FIXTURE_TARGET,
    status: 'active',
    snapshot: null,
    validationReport: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function fixtureWeek(w: number, overrides: Partial<Week> = {}): Week {
  return {
    id: `week-${w}`,
    programId: 'program-1',
    programVersionId: null,
    blockId: null,
    w,
    windowStart: addDays(FIXTURE_START, (w - 1) * 7),
    windowEnd: addDays(FIXTURE_START, (w - 1) * 7 + 6),
    kind: 'load',
    k: null,
    prescribedCount: 4,
    completedCount: 4,
    adherencePct: 1,
    allRepsCompleted: true,
    outcome: 'progress',
    generatedAt: NOW,
    generatedBy: 'engine',
    repeatOfWeek: null,
    jointHighStressCounts: null,
    highContactAllowance: null,
    extensiveTarget: null,
    ladderRungs: null,
    snapshot: null,
    ...overrides,
  };
}

export function fixtureSession(
  weekW: number,
  offset: number,
  overrides: Partial<SessionWithStatus> = {},
): SessionWithStatus {
  const date = addDays(FIXTURE_START, (weekW - 1) * 7 + offset);
  return {
    id: `session-${weekW}-${offset}`,
    programId: 'program-1',
    weekId: `week-${weekW}`,
    scheduledDate: date,
    orderIndex: offset,
    dayType: 'Lower Strength',
    blocksPresent: null,
    prescribedSetCount: 12,
    dismissed: false,
    testStatus: null,
    sorenessPre: null,
    rpe: 7,
    legsFeel: 'normal',
    notes: null,
    isMaximalCns: true,
    trimmedExercises: null,
    appliedModifications: null,
    shadowModifications: null,
    snapshot: null,
    createdAt: NOW,
    updatedAt: NOW,
    status: 'done',
    loggedSetCount: 12,
    startedAt: `${date}T17:00:00.000Z`,
    markedCompleteAt: `${date}T18:00:00.000Z`,
    whoopWorkoutId: null,
    ...overrides,
  };
}

/* ------------------------------------------------ the climbing streams */

/** One logged weighted-pull-up set, in the shape the Lifts query returns. */
export function fixtureLiftSet(overrides: Partial<LiftSetRow> = {}): LiftSetRow {
  return {
    exerciseId: 'weighted_pull_up',
    exerciseName: 'Weighted pull-up',
    loadType: 'heavy_strength',
    loadMode: 'percent',
    sessionId: 'session-1-1',
    localDate: FIXTURE_START,
    setNumber: 1,
    repsDone: 5,
    loadKg: lbToKg(35),
    rpe: 8,
    side: null,
    meanVelocityBest: null,
    velocityLossPct: null,
    ...overrides,
  };
}

/** One morning of Whoop recovery. A pending day carries no score. */
export function fixtureRecovery(
  localDate: string,
  recoveryScore: number | null,
  overrides: Partial<WhoopRecovery> = {},
): WhoopRecovery {
  return {
    id: `rec-${localDate}`,
    cycleId: null,
    sleepId: null,
    scoreState: recoveryScore === null ? 'PENDING_SCORE' : 'SCORED',
    userCalibrating: false,
    recoveryScore,
    restingHeartRate: null,
    hrvRmssdMilli: null,
    spo2Percentage: null,
    skinTempCelsius: null,
    timezoneOffset: null,
    localDate,
    raw: null,
    updatedAt: NOW,
    ...overrides,
  };
}

/** One seated med-ball throw, channel B of the gate. */
export function fixtureReadinessTest(
  localDate: string,
  best: number,
  overrides: Partial<ReadinessTestSession> = {},
): ReadinessTestSession {
  return {
    id: `throw-${localDate}`,
    athleteId: 'owner',
    localDate,
    kind: 'seated_mb_throw',
    metric: 'distance_m',
    attempts: [best - 0.2, best - 0.1, best],
    best,
    unit: 'm',
    whoopRecoverySnapshot: null,
    entrySource: 'typed',
    createdAt: `${localDate}T17:30:00.000Z`,
    ...overrides,
  };
}

/** One single-leg pair, with the gap computed the way the store computes it. */
export function fixtureSingleLeg(
  localDate: string,
  leftIn: number,
  rightIn: number,
): SingleLegTest {
  const pct = ((leftIn - rightIn) / Math.max(leftIn, rightIn)) * 100;
  return {
    id: `sl-${localDate}`,
    localDate,
    instrument: 'ovr_jump_regular',
    leftIn,
    rightIn,
    asymmetryPct: pct,
    weakerSide: Math.abs(pct) <= 3 ? null : pct > 0 ? 'right' : 'left',
  };
}

/** A whole set of sources: seven weeks, four sessions a week, six tests. */
export function fixtureSources(overrides: Partial<ProgressSources> = {}): ProgressSources {
  const weeks = [1, 2, 3, 4, 5, 6, 7].map((w) => fixtureWeek(w));
  const sessions = weeks.flatMap((week) =>
    [0, 1, 3, 5].map((offset) => fixtureSession(week.w, offset)),
  );
  return {
    today: FIXTURE_TODAY,
    athlete: fixtureAthlete(),
    program: fixtureProgram(),
    weeks,
    sessions,
    tests: fixtureTests(),
    recovery: [],
    sleep: [],
    workouts: [],
    liftSets: [],
    readinessTests: [],
    singleLegTests: [],
    connection: null,
    goalAcknowledgedAt: null,
    programAcknowledgedAt: null,
    ruleset: RULESET_V1,
    ...overrides,
  };
}
