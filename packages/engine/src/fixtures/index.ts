/**
 * @vert/engine/fixtures: the owner-like fixture, generated THROUGH the engine
 * so the runner shows real prescriptions rather than hand-written strings.
 *
 * The owner (brief section 16 "Answered on confirmation"): advanced, 4 days a
 * week (Mon, Tue, Thu, Sat), basketball, program built Mon 7 Sep 2026 with a
 * target of Sun 29 Nov 2026 (W = 12), baseline 29.4 in on OVR Jump, now week 7
 * of 12 in the Power block with weeks 1 to 6 logged, 6 canonical tests rising
 * to 32.5 in with one PR, and 90 days of Whoop mirrors with score states.
 *
 * Nothing in this module reads a clock, a file or `Math.random`: every date is
 * a literal and every choice goes through `mulberry32(seed)`.
 */
import { addDays, diffDays } from '../calendar.js';
import { inToMm, lbToKg } from '../units.js';
import {
  FIXTURE_CURRENT_WEEK,
  FIXTURE_FAILED_SET_WEEK,
  FIXTURE_PROGRAM_START,
  FIXTURE_SEED,
  FIXTURE_TARGET_DATE,
  FIXTURE_TEST_HEIGHTS_IN,
  FIXTURE_TODAY,
  runProgram,
  type ProgramSpec,
} from './program.js';
import { buildClimberFixture, type ClimberFixture } from './climber.js';
import type { Athlete } from '../types/athlete.js';
import type { LocalDate } from '../types/calendar.js';
import type { JumpTest } from '../types/analytics.js';
import type { PlanSkeleton, SessionPlan, WeekPlan } from '../types/plan.js';
import type { SessionRecord, SetLog } from '../types/logs.js';
import type { WhoopMirror } from './whoop.js';

export * from './whoop.js';
export * from './program.js';
export * from './climber.js';

/** Everything the app needs to boot into a realistic mid-program state. */
export interface OwnerFixture {
  athlete: Athlete;
  skeleton: PlanSkeleton;
  /** Weeks 1 to 7, materialized in order so each reads the one before it. */
  weeks: WeekPlan[];
  /** Logs for weeks 1 to 6 and week 7's Monday and Tuesday. */
  setLogs: SetLog[];
  sessions: SessionRecord[];
  /** Six canonical tests on the OVR Jump stream, rising to 32.5 in. */
  tests: JumpTest[];
  /** 90 days of Whoop mirrors, keyed by local date, with score states. */
  whoop: WhoopMirror;
  today: LocalDate;
  seed: number;
}

/** The owner, exactly as the contract describes them. */
export function ownerAthlete(): Athlete {
  return {
    id: 'owner',
    primaryGoal: 'vertical_jump',
    sport: 'basketball',
    trainingAge: '4plus',
    level: 'advanced',
    daysPerWeek: 4,
    weekdays: [1, 2, 4, 6],
    isAdult: true,
    clearance: {
      heartCondition: false,
      chestPain: false,
      dizziness: false,
      chronicCondition: false,
      prescriptionMedication: false,
      boneOrJointProblem: false,
      supervisedActivityOnly: false,
      isAdult: true,
      attestedAt: FIXTURE_PROGRAM_START,
    },
    painStatus: [],
    inventory: {
      barbell: true,
      rack: true,
      plates: { smallestPairLb: 5 },
      trapBar: true,
      dumbbells: { maxLb: 100, incrementLb: 5 },
      kettlebells: false,
      boxHeightsIn: [12, 18, 24, 30],
      hurdleHeightsIn: [6, 9, 12],
      bands: true,
      medBall: true,
      vestLb: 20,
      bench: true,
      pullupBar: true,
      cable: false,
      sled: false,
      weightRoomAccess: true,
    },
    bodyweightKg: lbToKg(181),
    // Entered back-squat 1RM only: no bench and no trap-bar max, so those two
    // run RPE mode in week 1 and pick up an Epley estimate from the logs.
    workingMaxes: [
      {
        lift: 'back_squat',
        valueKg: lbToKg(275),
        source: 'entered',
        confidence: 1,
        frozenAt: `${FIXTURE_PROGRAM_START}T03:00:00.000Z`,
        failStreak: 0,
      },
    ],
    inSeason: false,
    readinessPassedAt: '2026-09-01',
    standingReachMm: null,
    goalHeightMm: inToMm(36),
    targetDate: FIXTURE_TARGET_DATE,
    primaryInstrument: 'ovr_jump_regular',
    baselineHeightMm: inToMm(29.4),
    timezone: 'America/New_York',
    rolloverHour: 3,
    canonicalTestNote: 'Shoes on, gym floor, after the fixed primer.',
    sorenessHistory: [],
    extraEquipment: [],
  };
}

/** Sessions the owner completed, by week: week 3 misses one, week 7 has two done. */
function completedCount(w: number, sessions: readonly SessionPlan[]): number {
  if (w === 3) return 3;
  if (w === FIXTURE_CURRENT_WEEK) return 2;
  return sessions.length;
}

/** The owner's program, as `runProgram` reads it. */
function ownerSpec(athlete: Athlete, seed: number): ProgramSpec {
  return {
    athlete,
    programStart: FIXTURE_PROGRAM_START,
    today: FIXTURE_TODAY,
    currentWeek: FIXTURE_CURRENT_WEEK,
    seed,
    testHeightsIn: FIXTURE_TEST_HEIGHTS_IN,
    instrument: 'ovr_jump_regular',
    completed: completedCount,
    failedSetWeek: FIXTURE_FAILED_SET_WEEK,
    failedLift: 'back_squat',
  };
}

/**
 * Build the fixture. Deterministic: the seed and every date are literals here,
 * so two runs produce byte-identical output and screenshots do not drift.
 */
export function buildOwnerFixture(seed: number = FIXTURE_SEED): OwnerFixture {
  const athlete = ownerAthlete();
  const run = runProgram(ownerSpec(athlete, seed));
  return {
    athlete,
    skeleton: run.skeleton,
    weeks: run.weeks,
    setLogs: run.setLogs,
    sessions: run.sessions,
    tests: run.tests,
    whoop: run.whoop,
    today: FIXTURE_TODAY,
    seed,
  };
}

/**
 * The fixture the app boots into: the owner trains for speed climbing, so the
 * default is the climber. `buildOwnerFixture` stays exactly as it was, for the
 * basketball case the invariant tests and the app's older screenshots read.
 */
export function buildDefaultFixture(seed: number = FIXTURE_SEED): ClimberFixture {
  return buildClimberFixture(seed);
}

/** Days from the program start to the target, for the Plan header. */
export function fixtureProgramDays(): number {
  return diffDays(FIXTURE_PROGRAM_START, FIXTURE_TARGET_DATE);
}

/** The day after the fixture's last materialized week, for a "next week" view. */
export function fixtureNextWeekStart(): LocalDate {
  return addDays(FIXTURE_PROGRAM_START, FIXTURE_CURRENT_WEEK * 7);
}
