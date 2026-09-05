/**
 * The harness the SPEC FIDELITY lens runs on.
 *
 * Split out of the three `fixed-climber-spec*.test.ts` files so each of them
 * stays under the 500-line limit, the same way `grid.support.ts` carries the
 * invariant grid. Nothing here asserts: it builds the spec's athlete, varies
 * one axis of them, and materializes whole programs.
 */
import { addDays } from '../src/calendar.js';
import { indexById, loadExercises } from '../src/exercises/index.js';
import { loadRuleset } from '../src/ruleset/index.js';
import { planSkeleton } from '../src/skeleton/index.js';
import { materializeWeek } from '../src/materialize.js';
import { climberAthlete } from '../src/fixtures/climber.js';
import type { Athlete } from '../src/types/athlete.js';
import type { Weekday } from '../src/types/calendar.js';
import type { DaysPerWeek } from '../src/types/core.js';
import type {
  MaterializeContext,
  MaterializeHistory,
  SessionExercise,
  SessionPlan,
  WeekContext,
  WeekPlan,
} from '../src/types/plan.js';

export const ruleset = loadRuleset();
export const seed = loadExercises();
export const byId = indexById(seed.exercises);
export const climbing = ruleset.constants.climbing;

/** Mon 7 Sep 2026: day 0, the same start the fixtures and the grid use. */
export const START = '2026-09-07';
/** Twelve weeks out, so the layout table gives Strength, Deload, Power, Taper, Peak. */
export const TARGET = addDays(START, 11 * 7);

/** Weekday patterns inside the spec's "training days: 4 to 5". */
export const WEEKDAY_SETS: Weekday[][] = [
  [1, 2, 4, 6],
  [1, 2, 3, 6],
  [1, 2, 3, 4, 6],
  [0, 1, 2, 3, 4],
];

export const FOUR_DAY = WEEKDAY_SETS[0] as Weekday[];
export const FIVE_DAY = WEEKDAY_SETS[2] as Weekday[];

export function freshHistory(): MaterializeHistory {
  return {
    rotationHistory: {},
    ladderState: {},
    jointHighStressLastWeek: { knee: 0, spine: 0, shoulder: 0 },
    consecutiveAdherence: [],
    testPlateau: false,
    liftPlateau: {},
    liftRaisedSinceBlockStart: {},
  };
}

/** The spec's athlete with one axis varied. */
export function climber(patch: Partial<Athlete> = {}): Athlete {
  return { ...climberAthlete(), targetDate: TARGET, ...patch };
}

export function climberOnDays(weekdays: Weekday[]): Athlete {
  return climber({ daysPerWeek: weekdays.length as DaysPerWeek, weekdays });
}

export interface BuildOptions {
  history?: Partial<MaterializeHistory>;
  today?: string;
}

export function buildWeek(athlete: Athlete, w: number, options: BuildOptions = {}): WeekPlan {
  const skeleton = planSkeleton(athlete, START, ruleset);
  const context: MaterializeContext = {
    athlete,
    ruleset,
    exercises: seed.exercises,
    ladders: seed.ladders,
    skeleton,
    w,
    workingMaxes: athlete.workingMaxes,
    history: { ...freshHistory(), ...options.history },
    today: options.today ?? START,
    seed: 42,
  };
  return materializeWeek(context);
}

/** Every week of the athlete's own program, so no rule rests on one week. */
export function allWeeks(athlete: Athlete): WeekPlan[] {
  const total = planSkeleton(athlete, START, ruleset).weeks.length;
  const out: WeekPlan[] = [];
  for (let w = 1; w <= total; w += 1) out.push(buildWeek(athlete, w));
  return out;
}

export function rowsOf(session: SessionPlan): SessionExercise[] {
  return session.blocks.flatMap((block) => block.exercises);
}

/** Prescribed work: a warm-up or cool-down movement is not a prescription. */
export function prescribedRows(session: SessionPlan): SessionExercise[] {
  return session.blocks
    .filter((block) => block.name !== 'warm_up' && block.name !== 'cool_down')
    .flatMap((block) => block.exercises);
}

/** A Block 6 context for one lift, taken off the program's own skeleton. */
export function weekContextFor(athlete: Athlete, w: number, sets: number): WeekContext {
  const week = planSkeleton(athlete, START, ruleset).weeks[w - 1];
  if (week === undefined) throw new RangeError(`no week ${w}`);
  const context: WeekContext = {
    w,
    kind: week.kind,
    blockType: week.blockType,
    k: 0,
    targets: week.targets,
    isFirstProgramWeek1: false,
    isFirstPercentWeekForLift: false,
    sets,
    ruleset,
  };
  const max = athlete.workingMaxes[0];
  if (max !== undefined) {
    context.workingMax = max;
    context.squatWorkingMax = max;
  }
  return context;
}
