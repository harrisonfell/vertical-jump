/**
 * The machinery both fixtures run on: materialize week 1 to the current week
 * in order, log what the athlete did, carry the rolling history forward, and
 * build the canonical tests and the Whoop mirror.
 *
 * It is shared rather than copied so the basketball owner and the speed
 * climber can never drift into two different notions of what a logged week
 * is. Everything here is pure: every date is a caller's literal and every
 * choice goes through `mulberry32(seed)`.
 */
import { indexById, loadExercises } from '../exercises/index.js';
import {
  emptyMaterializeHistory,
  runWeekChain,
  type ChainOptions,
  type ChainState,
} from '../materialize.js';
import { mulberry32 } from '../prng.js';
import { usesAddedLoad } from '../prescribe/pullUp.js';
import { loadRuleset } from '../ruleset/index.js';
import { planSkeleton } from '../skeleton/index.js';
import { inToMm, lbToKg } from '../units.js';
import { buildWhoopMirror, type WhoopMirror } from './whoop.js';
import type { Athlete } from '../types/athlete.js';
import type { JumpRep, JumpTest } from '../types/analytics.js';
import type { LocalDate } from '../types/calendar.js';
import type { Instrument } from '../types/core.js';
import type { Exercise } from '../types/exercise.js';
import type { SessionRecord, SetLog } from '../types/logs.js';
import type { ReadinessTodayInput } from '../types/readiness.js';
import type { PlanSkeleton, SessionPlan, WeekPlan } from '../types/plan.js';

/* -------------------------------------------------- the fixture calendar */

/**
 * Both fixtures run the same program window, so a screenshot of one lines up
 * with a screenshot of the other and the Whoop mirror is comparable.
 *
 * Declared reading: the contract says "program built 8 Sep 2026". 8 Sep 2026
 * is a Tuesday, and the owner's day 0 is Monday, so a program built that day
 * would start Mon 14 Sep and run W = 11 with week 7's Power + Speed day on 29
 * Oct. The rest of the contract (W = 12, today Thu 22 Oct in week 7) only
 * holds from Mon 7 Sep, so that is the program start here.
 */
export const FIXTURES_VERSION = '0.1.0';

/** Mon 7 Sep 2026: day 0 and the program's first day. */
export const FIXTURE_PROGRAM_START: LocalDate = '2026-09-07';
/** Sun 29 Nov 2026: the target date the peak week is anchored to. */
export const FIXTURE_TARGET_DATE: LocalDate = '2026-11-29';
/** Thu 22 Oct 2026: week 7's test day, and the fixture's "today". */
export const FIXTURE_TODAY: LocalDate = '2026-10-22';
/** The current week: Power block, load week 2. */
export const FIXTURE_CURRENT_WEEK = 7;
/** The week whose main-lift top set comes up short, so R97 has something to read. */
export const FIXTURE_FAILED_SET_WEEK = 5;
/** The default seed, so two runs are byte-identical. */
export const FIXTURE_SEED = 20260907;

/** Six canonical tests, in inches, rising to a PR at 32.5. */
export const FIXTURE_TEST_HEIGHTS_IN = [29.4, 30.1, 30.6, 31.3, 31.7, 32.5];

/** What the athlete types into a row the engine showed in RPE mode. */
export type TypedLoad = (
  exercise: Exercise,
  squatMaxKg: number,
  rpe: number | undefined,
) => number | undefined;

/**
 * What the athlete actually put on the bar in RPE mode. The engine shows
 * "5 reps · RPE 6 · __ lb" and the athlete types a load; the fixture types the
 * hint ratio off the entered squat max, scaled by the set's RPE, so week 2
 * picks up an Epley estimate exactly as the brief's worked trap-bar case does.
 */
export const defaultTypedLoad: TypedLoad = (exercise, squatMaxKg, rpe) => {
  const ratio = exercise.oneRmHintRatio;
  if (!exercise.loadable || ratio === undefined) return undefined;
  const effort = rpe === undefined ? 0.75 : 0.62 + (rpe - 6) * 0.05;
  const lb = squatMaxKg * 2.2046226218 * ratio * effort;
  return lbToKg(Math.round(lb / 5) * 5);
};

/**
 * A tendon row types no load: its weight is a dumbbell the athlete may add,
 * and the fixtures log it at bodyweight, which is where the row starts and
 * what most athletes actually do. Inventing a dumbbell here would put a number
 * on the review screens that nobody lifted.
 */

/** The added load a climber puts on the belt, which is not a share of a squat. */
const ADDED_LOAD_BY_EFFORT_LB = { hard: 40, moderate: 35, easy: 30 } as const;

/**
 * The climber's typed loads. A weighted pull-up is loaded on a belt, so what
 * the athlete types is a plate weight in the tens of pounds and never a share
 * of the squat max; everything else types the same hint the owner does.
 */
export const climberTypedLoad: TypedLoad = (exercise, squatMaxKg, rpe) => {
  if (!usesAddedLoad(exercise)) return defaultTypedLoad(exercise, squatMaxKg, rpe);
  const effort = rpe ?? 7;
  const lb =
    effort >= 8
      ? ADDED_LOAD_BY_EFFORT_LB.hard
      : effort >= 7
        ? ADDED_LOAD_BY_EFFORT_LB.moderate
        : ADDED_LOAD_BY_EFFORT_LB.easy;
  return lbToKg(lb);
};

/** Everything one fixture program needs before it is run. */
export interface ProgramSpec {
  athlete: Athlete;
  programStart: LocalDate;
  /** The local day the fixture is "now"; the last week is materialized at it. */
  today: LocalDate;
  /** The last week materialized, 1-based. */
  currentWeek: number;
  seed: number;
  /** Canonical test heights, oldest first, one per week from week 1. */
  testHeightsIn: readonly number[];
  instrument: Instrument;
  /** Sessions completed in week w; the default is every one of them. */
  completed?: (w: number, sessions: readonly SessionPlan[]) => number;
  /**
   * Sets logged before the program started, which R73's four-week lookback
   * still reads at the first freezes. The owner's box squat history is here:
   * a retro-logged working set is a working set, so it reaches the working max
   * exactly as a set logged in the app does.
   */
  priorLogs?: SetLog[];
  /** The week whose top set on `failedLift` comes up short, for R97. */
  failedSetWeek?: number;
  failedLift?: string;
  /** Applied once to the skeleton as planned, before the first week is built. */
  patchSkeleton?: (skeleton: PlanSkeleton) => PlanSkeleton;
  typedLoad?: TypedLoad;
  /**
   * House `house.sc.readiness_gate`: the two channels for week `w`, or
   * undefined for a week the gate does not run on. Called with the scheduled
   * session dates in program order and the Whoop mirror, both of which are
   * known before the first week is built, because the gate has to be scored
   * before selection: holding the volume binds the target the week spends.
   */
  readinessToday?: (
    w: number,
    sessionDates: readonly LocalDate[],
    whoop: WhoopMirror,
  ) => ReadinessTodayInput | undefined;
}

/** One program run, in the shape both fixtures publish. */
export interface ProgramRun {
  /** The skeleton as planned, before any week's outcome moved it. */
  skeleton: PlanSkeleton;
  weeks: WeekPlan[];
  setLogs: SetLog[];
  sessions: SessionRecord[];
  tests: JumpTest[];
  whoop: WhoopMirror;
}

interface WeekLogs {
  logs: SetLog[];
  records: SessionRecord[];
}

/**
 * Every set logged as written, except the sessions `completed` leaves out and
 * the one failed top set `failedSetWeek` names, which is what R97 reads.
 */
function logWeek(
  week: WeekPlan,
  w: number,
  byId: ReadonlyMap<string, Exercise>,
  squatMaxKg: number,
  spec: ProgramSpec,
): WeekLogs {
  const logs: SetLog[] = [];
  const records: SessionRecord[] = [];
  const typedLoad = spec.typedLoad ?? defaultTypedLoad;
  const done = spec.completed?.(w, week.sessions) ?? week.sessions.length;

  week.sessions.forEach((session, index) => {
    if (index >= done) {
      records.push({
        sessionId: session.id,
        date: session.date,
        dayType: session.dayType,
        status: 'missed',
      });
      return;
    }
    records.push({
      sessionId: session.id,
      date: session.date,
      dayType: session.dayType,
      status: 'done',
      markedCompleteAt: `${session.date}T19:15:00.000Z`,
      legsFeel: 'normal',
    });

    for (const block of session.blocks) {
      if (block.name === 'warm_up' || block.name === 'cool_down') continue;
      for (const row of block.exercises) {
        for (const set of row.sets) {
          const failed =
            w === spec.failedSetWeek &&
            row.exerciseId === spec.failedLift &&
            set.setNumber === row.sets.length;
          const log: SetLog = {
            id: `${session.id}-${row.exerciseId}-${set.setNumber}`,
            sessionId: session.id,
            exerciseId: row.exerciseId,
            setNumber: set.setNumber,
            loadSource: row.loadMode,
            completedAt: `${session.date}T18:${String(20 + set.setNumber).padStart(2, '0')}:00.000Z`,
            plannedDate: session.date,
            idempotencyKey: `${session.id}:${row.exerciseId}:${set.setNumber}`,
          };
          if (set.reps !== undefined) log.repsDone = failed ? Math.max(1, set.reps - 2) : set.reps;
          if (set.durationS !== undefined) log.durationS = set.durationS;
          const exercise = byId.get(row.exerciseId);
          const typed =
            exercise === undefined ? undefined : typedLoad(exercise, squatMaxKg, set.targetRpe);
          if (set.loadKg !== undefined) log.loadKg = set.loadKg;
          else if (typed !== undefined) log.loadKg = typed;
          if (set.targetRpe !== undefined) log.rpe = set.targetRpe;
          if (row.boxHeightIn !== undefined) log.boxHeightIn = row.boxHeightIn;
          if (row.landingPromptOnLastSet && set.setNumber === row.sets.length) log.landing = 'good';
          logs.push(log);
        }
      }
    }
  });

  return { logs, records };
}

function testReps(heightIn: number, prng: ReturnType<typeof mulberry32>, id: string): JumpRep[] {
  const best = inToMm(heightIn);
  const reps: JumpRep[] = [];
  for (let index = 0; index < 5; index += 1) {
    const drop = index === 2 ? 0 : inToMm(prng.next() * 0.9);
    reps.push({
      id: `${id}-r${index + 1}`,
      repNumber: index + 1,
      heightMm: Math.round((best - drop) * 10) / 10,
      flagged: false,
      entrySource: 'typed',
    });
  }
  return reps;
}

/** One canonical test on each week's test day, oldest first. */
export function buildTests(
  weeks: readonly WeekPlan[],
  spec: ProgramSpec,
  bodyweightKg: number,
): JumpTest[] {
  const prng = mulberry32(spec.seed).fork('tests');
  const tests: JumpTest[] = [];
  spec.testHeightsIn.forEach((heightIn, index) => {
    const week = weeks[index];
    const session = week?.sessions.find((entry) => entry.isTestDay);
    if (week === undefined || session === undefined) return;
    const id = `test-w${week.w}`;
    tests.push({
      id,
      date: session.date,
      instrument: spec.instrument,
      mode: 'Regular',
      unitPreference: 'in',
      deviceFirmware: '2.4.1',
      ovrConnectVersion: '3.2.0',
      isBaseline: index === 0,
      canonical: true,
      scheduled: true,
      sessionId: session.id,
      bodyweightKg,
      reps: testReps(heightIn, prng, id),
      createdAt: `${session.date}T18:05:00.000Z`,
    });
  });
  return tests;
}

/**
 * Run one fixture program: materialize weeks 1 to `currentWeek` in order, each
 * reading the one before it, and log the ones that are behind us.
 *
 * The week-after-week loop itself lives in `materialize/chain.ts`, so the
 * projection and the fixtures fold exactly the same state. What stays here is
 * what makes this a fixture: the Whoop mirror, the readiness gate, the typed
 * loads, and the canonical tests.
 */
export function runProgram(spec: ProgramSpec): ProgramRun {
  const ruleset = loadRuleset();
  const { exercises, ladders } = loadExercises();
  const { athlete } = spec;
  const byId = indexById(exercises);
  const squatMaxKg = athlete.workingMaxes[0]?.valueKg ?? lbToKg(275);
  const planned = planSkeleton(athlete, spec.programStart, ruleset);
  const base = spec.patchSkeleton?.(planned) ?? planned;
  // The scheduled dates, and so the Whoop mirror, are known from the skeleton
  // before any week is built.
  const sessionDates = base.weeks
    .filter((week) => week.w <= spec.currentWeek)
    .flatMap((week) => week.sessions.map((session) => session.date));
  const whoop = buildWhoopMirror(
    spec.today,
    new Set<LocalDate>(sessionDates),
    mulberry32(spec.seed).fork('whoop'),
  );

  const options: ChainOptions = {
    athlete,
    ruleset,
    exercises,
    ladders,
    seed: spec.seed,
    todayFor: (w, week) =>
      w === spec.currentWeek ? spec.today : (week?.windowStart ?? spec.programStart),
    logWeek: (week, w) => logWeek(week, w, byId, squatMaxKg, spec),
    historyFor: (w, history) => {
      const readiness = spec.readinessToday?.(w, sessionDates, whoop);
      return readiness === undefined ? history : { ...history, readinessToday: readiness };
    },
  };
  if (spec.priorLogs !== undefined) options.priorLogs = spec.priorLogs;

  // The skeleton is carried forward: each week's outcome raises the next
  // week's start offsets, extensive floor and ladder rungs (R95, R96).
  const start: ChainState = {
    skeleton: base,
    history: emptyMaterializeHistory(),
    workingMaxes: athlete.workingMaxes,
    weeks: [],
    setLogs: [],
    sessions: [],
  };
  const end = runWeekChain(start, 1, spec.currentWeek, options);

  return {
    skeleton: base,
    weeks: end.weeks,
    setLogs: end.setLogs,
    sessions: end.sessions,
    tests: buildTests(end.weeks, spec, athlete.bodyweightKg ?? lbToKg(181)),
    whoop,
  };
}
