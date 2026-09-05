/**
 * The owner as they train today: a speed climber (IFSC 15 m), generated
 * THROUGH the engine on the same program window as the basketball fixture, so
 * a screenshot of one lines up with a screenshot of the other.
 *
 * The owner's athlete spec: advanced, four days a week (Mon, Tue, Wed, Fri)
 * in the gym from 08:00 to 10:00, climbing Tuesday, Thursday and Sunday
 * evenings from 18:00 to 20:00, vertical jump first and speed second, a
 * hangboard at home, a box squat entered at 320 lb with two working sets
 * logged behind it, a weighted pull-up whose working max comes off three weeks
 * of logged added load, an A2 pulley history that leaves only open-hand
 * pulling, no current pain, the seated med-ball throw configured as the
 * readiness test with nine prior throws on the books, and a left leg that came
 * out weaker on two single-leg tests.
 *
 * The gym picks are placed by the wall, not by the template order (house
 * `house.sc.sport_requirements`): Tuesday is a climbing day and the gym window
 * clears the wall by ten hours, so the upper-power day, which is the week's
 * one hard finger session, shares that day; Monday is the first pick that is
 * not a climbing day, so the heavy squat takes it; Wednesday is two days after
 * the squat with Tuesday between them (R91, R93), so the test lands there; and
 * Friday takes the recovery day.
 *
 * House rules in play, all shipped in the ruleset: `house.sc.sport_requirements`,
 * `house.sc.upper_power_day`, `house.sc.open_hand_grip`,
 * `house.sc.hard_finger_spacing`, `house.sc.finger_pain_ceiling`,
 * `house.sc.rnt_valgus_control`, `house.sc.weaker_side_first`,
 * `house.sc.box_squat_main_lift`, `house.sc.readiness_gate` and
 * `house.sc.asymmetry_tracking`.
 *
 * Nothing here reads a clock, a file or `Math.random`.
 */
import { mulberry32 } from '../prng.js';
import { loadRuleset } from '../ruleset/index.js';
import { asymmetryPct, weakerSideFrom } from '../analytics/asymmetry.js';
import { inToMm, lbToKg, roundHalfUp } from '../units.js';
import {
  FIXTURE_CURRENT_WEEK,
  FIXTURE_PROGRAM_START,
  FIXTURE_SEED,
  FIXTURE_TARGET_DATE,
  FIXTURE_TEST_HEIGHTS_IN,
  climberTypedLoad,
  runProgram,
  type ProgramSpec,
} from './program.js';
export * from './climberLifts.js';
import {
  climberBestSets,
  climberPriorLogs,
  climberStaleBoxSquat,
  climberWorkingMaxes,
} from './climberLifts.js';
import type { WhoopMirror } from './whoop.js';
import type { OwnerFixture } from './index.js';
import type { Athlete, WorkingMax } from '../types/athlete.js';
import type { LocalDate } from '../types/calendar.js';
import type { Side } from '../types/core.js';
import type { PlanSkeleton, SessionPlan } from '../types/plan.js';
import type {
  ReadinessTestConfig,
  ReadinessTestSession,
  ReadinessTodayInput,
  ReadinessWhoopInput,
  SingleLegTest,
} from '../types/readiness.js';

/**
 * The climber's own "today": Wednesday 21 Oct 2026, week 7's Power + Speed
 * test day. The basketball owner tests on the Thursday of the same week and
 * keeps `FIXTURE_TODAY`; the climber's picks put the test a day earlier, so
 * the two fixtures share a program window but not a test day.
 */
export const CLIMBER_TODAY: LocalDate = '2026-10-21';

/** The climber's bodyweight: 150 lb, which is where a 15 m specialist sits. */
export const CLIMBER_BODYWEIGHT_LB = 150;

/** The readiness test the gate's neuromuscular channel runs on. */
export function climberReadinessConfig(): ReadinessTestConfig {
  return { ...loadRuleset().constants.climbing.readiness };
}

/** The climber, exactly as the owner's athlete spec describes them. */
export function climberAthlete(): Athlete {
  return {
    id: 'owner',
    primaryGoal: 'vertical_jump',
    // R113: the second goal is speed, which is what puts acceleration work at
    // the front of the Power day's jump pool.
    secondaryGoal: 'speed',
    sport: 'speed_climbing',
    trainingAge: '4plus',
    level: 'advanced',
    daysPerWeek: 4,
    weekdays: [1, 2, 3, 5],
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
    // No knee, back, shoulder, shin or Achilles pain: no Block 1 cap is
    // active. The A2 pulley history is history, not current pain, so it sets
    // the grip and the finger spacing rather than a pain template.
    painStatus: [],
    inventory: {
      barbell: true,
      rack: true,
      plates: { smallestPairLb: 5 },
      trapBar: false,
      dumbbells: { maxLb: 100, incrementLb: 5 },
      kettlebells: false,
      boxHeightsIn: [12, 18, 24, 30],
      hurdleHeightsIn: [],
      bands: true,
      medBall: true,
      bench: true,
      pullupBar: true,
      cable: false,
      sled: false,
      hangboard: true,
      boxSquatBox: true,
      climbingWall: true,
      weightRoomAccess: true,
    },
    bodyweightKg: lbToKg(CLIMBER_BODYWEIGHT_LB),
    workingMaxes: climberWorkingMaxes(),
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
    fingerHistory: true,
    gripMode: 'open_hand',
    fingerPainCeiling: 3,
    wallWork: {
      weekdays: [0, 2, 4],
      typicalStart: '18:00',
      typicalEnd: '20:00',
      fingerLoad: 'hard',
      sameDayGapHours: 6,
    },
    sessionWindow: { start: '08:00', end: '10:00' },
    bestSets: climberBestSets(),
    valgusControl: { required: true, sessionsPerWeek: 2, minHoursFromWall: 6 },
    weakerSide: 'left',
    readinessConfig: climberReadinessConfig(),
  };
}

/** Nine prior seated med-ball throws, in metres, oldest first. */
export const CLIMBER_PRIOR_THROWS_M = [7.0, 7.2, 7.1, 7.0, 7.2, 7.1, 7.1, 7.2, 7.0];
/** Today's throw, which sits inside the band and so reads as high. */
export const CLIMBER_THROW_TODAY_M = 7.15;

/** Two single-leg jump tests, left and right, on the OVR Jump. */
export const CLIMBER_SINGLE_LEG_TESTS: readonly { date: LocalDate; leftIn: number; rightIn: number }[] =
  [
    { date: '2026-09-15', leftIn: 17.2, rightIn: 18.9 },
    { date: '2026-10-13', leftIn: 17.9, rightIn: 19.2 },
  ];

/**
 * The main lifts this sport runs (`house.sc.box_squat_main_lift`, the upper
 * day's weighted pull-up). Held here so the fixture is honest about the
 * owner's program even before the skeleton picks its main lifts by sport; the
 * patch is a no-op once it does.
 */
export const CLIMBER_MAIN_LIFTS = {
  lower: 'box_squat',
  upper: 'weighted_pull_up',
  fullbody: 'box_squat',
} as const;

/** Sessions completed, by week: week 3 misses one, the current week has two done. */
function completedCount(w: number, sessions: readonly SessionPlan[]): number {
  if (w === 3) return 3;
  if (w === FIXTURE_CURRENT_WEEK) return 2;
  return sessions.length;
}

/**
 * `house.sc.box_squat_main_lift`: the climber's main lifts, every week. The
 * skeleton picks the same two by sport, so this is a no-op that keeps the
 * fixture honest about the owner's program if that ever changes.
 */
function patchMainLifts(skeleton: PlanSkeleton): PlanSkeleton {
  return {
    ...skeleton,
    weeks: skeleton.weeks.map((week) => ({
      ...week,
      targets: { ...week.targets, mainLiftBySlot: { ...CLIMBER_MAIN_LIFTS } },
    })),
  };
}

/** Three attempts around one best, so the session carries what the test asks. */
function throwAttempts(best: number, prng: ReturnType<typeof mulberry32>): number[] {
  const first = roundHalfUp(best - 0.1 - prng.next() * 0.2, 2);
  const second = roundHalfUp(best - prng.next() * 0.15, 2);
  return [first, second, best];
}

/**
 * The seated med-ball throws behind the gate's neuromuscular channel: nine
 * prior sessions on the training days before today, plus today's, which is the
 * one the gate scores against the rolling median of the nine.
 */
export function climberReadinessTests(
  trainingDates: readonly LocalDate[],
  seed: number,
): ReadinessTestSession[] {
  const prng = mulberry32(seed).fork('readiness');
  const before = trainingDates.filter((date) => date < CLIMBER_TODAY);
  const dates = before.slice(Math.max(0, before.length - CLIMBER_PRIOR_THROWS_M.length));
  const sessions: ReadinessTestSession[] = [];
  CLIMBER_PRIOR_THROWS_M.forEach((best, index) => {
    const date = dates[index];
    if (date === undefined) return;
    sessions.push({
      id: `throw-${date}`,
      date,
      kind: 'seated_mb_throw',
      attempts: throwAttempts(best, prng),
      best,
      unit: 'm',
    });
  });
  sessions.push({
    id: `throw-${CLIMBER_TODAY}`,
    date: CLIMBER_TODAY,
    kind: 'seated_mb_throw',
    attempts: throwAttempts(CLIMBER_THROW_TODAY_M, prng),
    best: CLIMBER_THROW_TODAY_M,
    unit: 'm',
  });
  return sessions;
}

/** The two single-leg tests, with the gap computed rather than typed. */
export function climberSingleLegTests(bandPct: number): SingleLegTest[] {
  return CLIMBER_SINGLE_LEG_TESTS.map((entry) => {
    const pct = asymmetryPct(entry.leftIn, entry.rightIn);
    return {
      date: entry.date,
      instrument: 'ovr_jump_regular',
      leftIn: entry.leftIn,
      rightIn: entry.rightIn,
      asymmetryPct: pct,
      weakerSide: Math.abs(pct) <= bandPct ? null : pct > 0 ? 'right' : 'left',
    };
  });
}

/** Whoop's own band cuts, kept in Whoop's vocabulary. */
function whoopBand(score: number | null): ReadinessWhoopInput['band'] {
  if (score === null) return null;
  if (score >= 67) return 'high';
  if (score >= 34) return 'moderate';
  return 'low';
}

/**
 * Today's recovery, as the gate's autonomic channel reads it: the score and
 * Whoop's own band word, or nulls when the day was not scored, which is what a
 * `PENDING_SCORE` or `UNSCORABLE` day looks like.
 */
export function climberWhoopToday(whoop: WhoopMirror, date: LocalDate = CLIMBER_TODAY): ReadinessWhoopInput {
  const recovery = whoop.recoveries.find((row) => row.localDay === date);
  const score = recovery?.score?.recovery_score ?? null;
  return { date, score, band: whoopBand(score) };
}

/**
 * The most recent day the strap did score, at or before `date`. Today's cycle
 * is `PENDING_SCORE` in the mirror, which is the "one channel missing" day the
 * house rule names, so the two-channel view reads the last scored day beside
 * it rather than inventing a number for today.
 */
export function climberWhoopLastScored(
  whoop: WhoopMirror,
  date: LocalDate = CLIMBER_TODAY,
): ReadinessWhoopInput {
  const row = [...whoop.recoveries]
    .reverse()
    .find((entry) => entry.score !== undefined && entry.localDay <= date);
  const score = row?.score?.recovery_score ?? null;
  return { date: row?.localDay ?? date, score, band: whoopBand(score) };
}

/** Everything the owner fixture carries, plus what the climbing rules read. */
export interface ClimberFixture extends OwnerFixture {
  /** The gate's swappable neuromuscular test (`house.sc.readiness_gate`). */
  readinessConfig: ReadinessTestConfig;
  /** Nine prior seated med-ball throws and today's, oldest first. */
  readinessTests: ReadinessTestSession[];
  /**
   * Today's Whoop recovery, as the gate's autonomic channel reads it. Today's
   * cycle is still `PENDING_SCORE` in the mirror, so the score is null: this
   * is the "one channel missing" day the house rule names, where the
   * neuromuscular channel alone may adjust the session.
   */
  readinessWhoopToday: ReadinessWhoopInput;
  /** The most recent day the strap did score, for the two-channel view. */
  readinessWhoopLastScored: ReadinessWhoopInput;
  /** Two single-leg jump tests (`house.sc.asymmetry_tracking`). */
  singleLegTests: SingleLegTest[];
  /** The side that goes first on unilateral work, from those two tests. */
  weakerSide: Side | null;
  /** The stale 345 lb the entered 320 lb retired, kept so the test can say so. */
  staleBoxSquat: WorkingMax;
}

/**
 * House `house.sc.readiness_gate`, wired into the run: the current week's
 * Thursday is "today", so the gate scores that day's two channels and the
 * session carries the line. Every earlier week returns undefined, which is
 * what a day the athlete did not test looks like.
 */
export function climberReadinessToday(
  seed: number,
): (w: number, dates: readonly LocalDate[], whoop: WhoopMirror) => ReadinessTodayInput | undefined {
  return (w, dates, whoop) => {
    if (w !== FIXTURE_CURRENT_WEEK) return undefined;
    const tests = climberReadinessTests(dates, seed);
    const today = tests.at(-1) ?? null;
    return {
      config: climberReadinessConfig(),
      whoop: climberWhoopToday(whoop),
      test: today,
      history: tests.slice(0, -1),
    };
  };
}

/**
 * The climber's program, as `runProgram` reads it. Exported so a test can run
 * a shorter slice of the same program without rebuilding the athlete.
 */
export function climberProgramSpec(athlete: Athlete, seed: number = FIXTURE_SEED): ProgramSpec {
  return {
    athlete,
    programStart: FIXTURE_PROGRAM_START,
    today: CLIMBER_TODAY,
    currentWeek: FIXTURE_CURRENT_WEEK,
    seed,
    testHeightsIn: FIXTURE_TEST_HEIGHTS_IN,
    instrument: 'ovr_jump_regular',
    completed: completedCount,
    // No in-program failed set: the box squat's failure is the one the entered
    // 320 lb already accounts for, so R97 has nothing to re-apply here.
    patchSkeleton: patchMainLifts,
    priorLogs: climberPriorLogs(),
    typedLoad: climberTypedLoad,
    readinessToday: climberReadinessToday(seed),
  };
}

/**
 * Build the climber fixture. Deterministic: the seed and every date are
 * literals, so two runs produce byte-identical output and screenshots do not
 * drift.
 */
export function buildClimberFixture(seed: number = FIXTURE_SEED): ClimberFixture {
  const ruleset = loadRuleset();
  const athlete = climberAthlete();
  const run = runProgram(climberProgramSpec(athlete, seed));

  const trainingDates = run.weeks.flatMap((week) => week.sessions.map((session) => session.date));
  const readinessTests = climberReadinessTests(trainingDates, seed);
  const singleLegTests = climberSingleLegTests(ruleset.constants.climbing.asymmetryBandPct);
  return {
    athlete,
    skeleton: run.skeleton,
    weeks: run.weeks,
    setLogs: run.setLogs,
    sessions: run.sessions,
    tests: run.tests,
    whoop: run.whoop,
    today: CLIMBER_TODAY,
    seed,
    readinessConfig: climberReadinessConfig(),
    readinessTests,
    readinessWhoopToday: climberWhoopToday(run.whoop),
    readinessWhoopLastScored: climberWhoopLastScored(run.whoop),
    singleLegTests,
    weakerSide: weakerSideFrom(
      singleLegTests,
      athlete.weakerSide,
      ruleset.constants.climbing.asymmetryBandPct,
    ),
    staleBoxSquat: climberStaleBoxSquat(),
  };
}
