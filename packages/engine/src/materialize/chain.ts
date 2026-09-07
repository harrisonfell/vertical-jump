/**
 * The week-after-week fold: materialize week w, log what the athlete did,
 * carry the rolling history and the advanced skeleton forward, repeat.
 *
 * Both callers run on this one loop rather than on two copies of it. The
 * fixtures (`fixtures/program.ts`) feed it real logged outcomes; the projection
 * (`materialize/project.ts`) feeds it the week as written. A third entry,
 * `foldObservedWeeks`, carries the same state through weeks the engine is not
 * re-materializing, which is what a revision needs before it projects.
 *
 * Everything here is pure: no clock, no `Math.random`, no I/O. Every date
 * arrives from the caller and every choice goes through `mulberry32(seed)`.
 */
import { materializeWeek } from '../materialize.js';
import { advancedSkeletonFor } from './outcome.js';
import type { Athlete, WorkingMax } from '../types/athlete.js';
import type { IsoInstant, LocalDate } from '../types/calendar.js';
import type { LadderId } from '../types/core.js';
import type { Exercise, ProgressionLadder } from '../types/exercise.js';
import type { SessionRecord, SetLog } from '../types/logs.js';
import type { Ruleset } from '../types/ruleset.js';
import type {
  MaterializeContext,
  MaterializeHistory,
  PlanSkeleton,
  PreviousWeekContext,
  SkeletonWeek,
  WeekPlan,
} from '../types/plan.js';

/** Everything one week of the chain carries into the next. */
export interface ChainState {
  /** The skeleton as the outcomes so far have moved it. */
  skeleton: PlanSkeleton;
  history: MaterializeHistory;
  /** The maxes the next week freezes from: the last week's, else the seed. */
  workingMaxes: WorkingMax[];
  prevWeek?: PreviousWeekContext;
  weeks: WeekPlan[];
  setLogs: SetLog[];
  sessions: SessionRecord[];
}

/** The parts of a chain that do not change from week to week. */
export interface ChainOptions {
  athlete: Athlete;
  ruleset: Ruleset;
  exercises: Exercise[];
  ladders: ProgressionLadder[];
  seed: number;
  generatedAt?: IsoInstant;
  /** Logs from before week 1 that R73's four-week lookback still reads. */
  priorLogs?: readonly SetLog[];
  /** The local day week w is materialized "at". */
  todayFor: (w: number, week: SkeletonWeek | undefined) => LocalDate;
  /** What the athlete did in the week just built. */
  logWeek: (week: WeekPlan, w: number) => { logs: SetLog[]; records: SessionRecord[] };
  /** Per-week history overlay; the fixtures use it for the readiness gate. */
  historyFor?: (w: number, history: MaterializeHistory) => MaterializeHistory;
}

/** What `foldObservedWeeks` needs, which is everything but the logging half. */
export type ObservedOptions = Omit<ChainOptions, 'logWeek'>;

/**
 * A stored week refused the fold: its snapshot is unreadable, it was generated
 * by a different ruleset, or its logs name no set the plan prescribed. Carries
 * a sentence the app can show, because guessing here would silently drop every
 * real week to a `hold` (see the design's section 9).
 */
export class ObservedWeekError extends Error {
  readonly sentence: string;
  readonly w: number;

  constructor(w: number, sentence: string) {
    super(sentence);
    this.name = 'ObservedWeekError';
    this.sentence = sentence;
    this.w = w;
  }
}

/** A first program has no history: nothing has been logged yet. */
export function emptyMaterializeHistory(): MaterializeHistory {
  return {
    firstProgram: true,
    rotationHistory: {},
    ladderState: {},
    percentWeekIndexByLift: {},
    jointHighStressLastWeek: { knee: 0, spine: 0, shoulder: 0 },
    consecutiveAdherence: [],
    testPlateau: false,
    liftPlateau: {},
    liftRaisedSinceBlockStart: {},
  };
}

/** Rolling state week w reads: rotation, ladders, joint load and adherence. */
export function advanceHistory(
  history: MaterializeHistory,
  week: WeekPlan,
  adherence: number,
  ladderIds: readonly LadderId[],
): MaterializeHistory {
  const rotationHistory: Record<string, number[]> = {};
  for (const [id, weeks] of Object.entries(history.rotationHistory)) rotationHistory[id] = [...weeks];
  const joints = { knee: 0, spine: 0, shoulder: 0 };
  for (const session of week.sessions) {
    for (const block of session.blocks) {
      if (block.name === 'warm_up') continue;
      for (const row of block.exercises) {
        const seen = rotationHistory[row.exerciseId] ?? [];
        if (!seen.includes(week.w)) seen.push(week.w);
        rotationHistory[row.exerciseId] = seen;
      }
    }
  }

  const ladderState: MaterializeHistory['ladderState'] = {};
  for (const id of ladderIds) {
    const previous = history.ladderState[id];
    const rung = previous?.rung ?? 0;
    const spent = previous?.advancesThisBlock ?? 0;
    const advance = week.kind === 'load' && spent < 2 ? 1 : 0;
    ladderState[id] = { rung: rung + advance, advancesThisBlock: spent + advance };
  }

  const percentWeekIndexByLift: Record<string, number> = {
    ...(history.percentWeekIndexByLift ?? {}),
  };
  for (const session of week.sessions) {
    for (const block of session.blocks) {
      for (const row of block.exercises) {
        if (!row.sets.some((set) => set.loadPercent !== undefined)) continue;
        percentWeekIndexByLift[row.exerciseId] = (percentWeekIndexByLift[row.exerciseId] ?? -1) + 1;
      }
    }
  }

  return {
    ...history,
    firstProgram: true,
    rotationHistory,
    ladderState,
    percentWeekIndexByLift,
    jointHighStressLastWeek: joints,
    consecutiveAdherence: [...history.consecutiveAdherence, adherence],
  };
}

/** The context week w is built from, identical for a built and an observed week. */
function chainContext(state: ChainState, w: number, options: ObservedOptions): MaterializeContext {
  const skeletonWeek = state.skeleton.weeks.find((entry) => entry.w === w);
  const context: MaterializeContext = {
    athlete: options.athlete,
    ruleset: options.ruleset,
    exercises: options.exercises,
    ladders: options.ladders,
    skeleton: state.skeleton,
    w,
    workingMaxes: state.workingMaxes,
    history: state.history,
    today: options.todayFor(w, skeletonWeek),
    seed: options.seed,
    recentLogs: [...(options.priorLogs ?? []), ...state.setLogs],
  };
  if (options.generatedAt !== undefined) context.generatedAt = options.generatedAt;
  const overlay = options.historyFor?.(w, state.history);
  if (overlay !== undefined) context.history = overlay;
  if (state.prevWeek !== undefined) context.prevWeek = state.prevWeek;
  return context;
}

/** Sessions marked done over sessions scheduled, the fraction R130 reads. */
function adherenceOf(week: WeekPlan, records: readonly SessionRecord[]): number {
  const done = records.filter((record) => record.status === 'done').length;
  return week.sessions.length === 0 ? 0 : done / week.sessions.length;
}

/**
 * One week of the chain: build it, log it, and hand back the state week w + 1
 * reads. Split out of `runWeekChain` so a caller can await a paint between
 * weeks without the engine itself ever becoming asynchronous.
 */
export function stepWeekChain(state: ChainState, w: number, options: ChainOptions): ChainState {
  const context = chainContext(state, w, options);
  const week = materializeWeek(context);
  const skeleton = advancedSkeletonFor(context);
  const { logs, records } = options.logWeek(week, w);
  const ladderIds = options.ladders.map((ladder) => ladder.id);

  return {
    skeleton,
    history: advanceHistory(state.history, week, adherenceOf(week, records), ladderIds),
    workingMaxes: week.snapshot.workingMaxes,
    prevWeek: { plan: week, logs, sessions: records },
    weeks: [...state.weeks, week],
    setLogs: [...state.setLogs, ...logs],
    sessions: [...state.sessions, ...records],
  };
}

/** Fold `stepWeekChain` over weeks `fromWeek` to `toWeek`, inclusive. */
export function runWeekChain(
  state: ChainState,
  fromWeek: number,
  toWeek: number,
  options: ChainOptions,
): ChainState {
  let next = state;
  for (let w = fromWeek; w <= toWeek; w += 1) next = stepWeekChain(next, w, options);
  return next;
}

/**
 * Refuse an observed week the fold cannot trust. A stored snapshot from an
 * older ruleset, or logs that name no prescribed set, would both fold into a
 * plausible but wrong history, and nothing downstream would notice.
 */
function checkObserved(observed: PreviousWeekContext, ruleset: Ruleset): void {
  // The plan arrives from a stored snapshot, so it is checked as untrusted
  // input even though the type says it cannot be missing.
  const plan: Partial<WeekPlan> | undefined = observed.plan;
  const w = plan?.w ?? 0;
  if (plan === undefined || !Array.isArray(plan.sessions) || plan.snapshot === undefined) {
    throw new ObservedWeekError(w, `Week ${w} has no readable saved plan, so it cannot be revised.`);
  }
  if (plan.snapshot.rulesetVersion !== ruleset.version) {
    throw new ObservedWeekError(
      w,
      `Week ${w} was built on rule book ${plan.snapshot.rulesetVersion}, not ${ruleset.version}.`,
    );
  }
  if (observed.logs.length === 0) return;

  const prescribed = new Set<string>();
  for (const session of plan.sessions) {
    for (const block of session.blocks) {
      for (const row of block.exercises) {
        for (const set of row.sets) {
          prescribed.add(`${session.id}|${row.exerciseId}|${set.setNumber}`);
        }
      }
    }
  }
  const matched = observed.logs.some((log) =>
    prescribed.has(`${log.sessionId}|${log.exerciseId}|${log.setNumber}`),
  );
  if (!matched) {
    throw new ObservedWeekError(
      w,
      `Week ${w}'s logged sets match nothing it prescribed, so it cannot be revised.`,
    );
  }
}

/**
 * Carry the chain through weeks the engine is NOT re-materializing: the weeks
 * the athlete really trained. For each one it builds the same context and calls
 * `advancedSkeletonFor`, which runs `computeAdherence` and `decideOutcome` and
 * never touches selection, then folds the same `advanceHistory`. The result is
 * the state a projection of the following week must start from.
 */
export function foldObservedWeeks(
  state: ChainState,
  observed: readonly PreviousWeekContext[],
  options: ObservedOptions,
): ChainState {
  const ladderIds = options.ladders.map((ladder) => ladder.id);
  let next = state;
  let last = 0;

  for (const week of observed) {
    checkObserved(week, options.ruleset);
    const plan = week.plan;
    // Out of order, the fold would judge the wrong week against the wrong one
    // and say nothing about it.
    if (plan.w <= last) {
      throw new ObservedWeekError(plan.w, `Week ${plan.w} came after week ${last} in the fold.`);
    }
    last = plan.w;
    const context = chainContext(next, plan.w, options);
    next = {
      skeleton: advancedSkeletonFor(context),
      history: advanceHistory(next.history, plan, adherenceOf(plan, week.sessions), ladderIds),
      workingMaxes: plan.snapshot.workingMaxes,
      prevWeek: week,
      weeks: next.weeks,
      setLogs: [...next.setLogs, ...week.logs],
      sessions: [...next.sessions, ...week.sessions],
    };
  }
  return next;
}
