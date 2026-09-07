/**
 * The projection: weeks 2..W built up front, each one fed the week before it
 * under the assumption that the week went exactly as written.
 *
 * A projected week is the athlete's best case, and it is labelled as one in the
 * app for that reason. Every prescribed set is logged at its prescribed reps,
 * every session is marked done, nothing is sore and nothing hurts, so every
 * week judges `progress` and the rolling history carries forward exactly as it
 * would for a real week. The moment a real week is logged, the weeks after it
 * are re-projected from those outcomes instead.
 *
 * Pure: every timestamp is derived from the plan's own dates, so two runs with
 * the same seed are byte-identical. No `Date.now`, no `Math.random`.
 */
import {
  emptyMaterializeHistory,
  foldObservedWeeks,
  runWeekChain,
  type ChainOptions,
  type ChainState,
} from './chain.js';
import type { Athlete, WorkingMax } from '../types/athlete.js';
import type { IsoInstant, LocalDate } from '../types/calendar.js';
import type { Exercise, ProgressionLadder } from '../types/exercise.js';
import type { SessionRecord, SetLog } from '../types/logs.js';
import type { Ruleset } from '../types/ruleset.js';
import type {
  MaterializeHistory,
  PlanSkeleton,
  PreviousWeekContext,
  SessionPlan,
  WeekPlan,
} from '../types/plan.js';

/** Everything one projection run needs. Nothing here is mutated. */
export interface ProjectionInput {
  athlete: Athlete;
  ruleset: Ruleset;
  exercises: Exercise[];
  ladders: ProgressionLadder[];
  /** The skeleton as planned. Never mutated. */
  skeleton: PlanSkeleton;
  seed: number;
  /** The first projected week is materialized at this day; later weeks at their windowStart. */
  today: LocalDate;
  generatedAt?: IsoInstant;
  /** 1-based, inclusive. 1 at first build. */
  fromWeek: number;
  /** 1-based, inclusive. Defaults to skeleton.W. */
  toWeek?: number;
  /** Weeks 1..fromWeek-1 as they were really built and really logged. */
  observed?: readonly PreviousWeekContext[];
  /** Seed maxes when observed is empty. */
  workingMaxes: WorkingMax[];
  priorLogs?: readonly SetLog[];
}

/** One projection run. */
export interface ProjectedProgram {
  /** Weeks fromWeek..toWeek, in order. */
  weeks: WeekPlan[];
  /** The synthesized "as written" logs and records for those weeks. */
  logs: SetLog[];
  sessions: SessionRecord[];
  /** Rolling state after the last projected week. */
  history: MaterializeHistory;
  /** The skeleton after the last projected week's outcome. */
  skeleton: PlanSkeleton;
}

/** The evening a projected session is taken to have been finished at. */
const RECORD_TIME = 'T19:15:00.000Z';

/**
 * One session's worth of "as written": every prescribed set of every working
 * row logged at exactly what it prescribed.
 *
 * No load is ever invented. A row the engine showed in RPE mode carries no
 * `loadKg` on its sets, so its log carries none either, and the lift stays in
 * RPE mode for every projected week after it. That reads as "5 reps, RPE 7,
 * __ lb" on screen, which is the honest display for a load the athlete has not
 * typed yet; a fabricated squat-derived number would not be.
 */
function logSession(session: SessionPlan, logs: SetLog[], records: SessionRecord[]): void {
  records.push({
    sessionId: session.id,
    date: session.date,
    dayType: session.dayType,
    status: 'done',
    markedCompleteAt: `${session.date}${RECORD_TIME}`,
    legsFeel: 'normal',
  });

  for (const block of session.blocks) {
    if (block.name === 'warm_up' || block.name === 'cool_down') continue;
    for (const row of block.exercises) {
      for (const set of row.sets) {
        const minute = String(20 + set.setNumber).padStart(2, '0');
        const log: SetLog = {
          id: `${session.id}-${row.exerciseId}-${set.setNumber}`,
          sessionId: session.id,
          exerciseId: row.exerciseId,
          setNumber: set.setNumber,
          loadSource: row.loadMode,
          completedAt: `${session.date}T18:${minute}:00.000Z`,
          plannedDate: session.date,
          idempotencyKey: `${session.id}:${row.exerciseId}:${set.setNumber}`,
        };
        if (set.reps !== undefined) log.repsDone = set.reps;
        if (set.durationS !== undefined) log.durationS = set.durationS;
        if (set.loadKg !== undefined) log.loadKg = set.loadKg;
        if (set.targetRpe !== undefined) log.rpe = set.targetRpe;
        if (row.boxHeightIn !== undefined) log.boxHeightIn = row.boxHeightIn;
        if (row.landingPromptOnLastSet && set.setNumber === row.sets.length) log.landing = 'good';
        logs.push(log);
      }
    }
  }
}

/** The week as written: every session done, every set logged at its target. */
export function asWrittenLogs(week: WeekPlan): { logs: SetLog[]; records: SessionRecord[] } {
  const logs: SetLog[] = [];
  const records: SessionRecord[] = [];
  for (const session of week.sessions) logSession(session, logs, records);
  return { logs, records };
}

/** The last week a projection covers: the caller's, else the program's last. */
function lastWeek(input: ProjectionInput): number {
  return input.toWeek ?? input.skeleton.W;
}

/**
 * The chain state the first projected week reads: an empty history with the
 * observed weeks folded through it, so a revision starts from exactly the
 * rotation, ladders, joint load and adherence the real weeks produced.
 */
export function projectionStart(input: ProjectionInput): ChainState {
  const state: ChainState = {
    skeleton: input.skeleton,
    history: emptyMaterializeHistory(),
    workingMaxes: input.workingMaxes,
    weeks: [],
    setLogs: [],
    sessions: [],
  };
  const observed = input.observed ?? [];
  if (observed.length === 0) return state;
  return foldObservedWeeks(state, observed, projectionOptions(input));
}

/**
 * The chain options a projection runs on. Week `fromWeek` is materialized at
 * the caller's `today`; every later week at its own window start, exactly as
 * the fixture chain does, so today's soreness, finger pain and readiness
 * answers never leak into a week that has not arrived yet. `readinessToday` is
 * never set on a projected history at all, so the gate does not run.
 */
export function projectionOptions(input: ProjectionInput): ChainOptions {
  const options: ChainOptions = {
    athlete: input.athlete,
    ruleset: input.ruleset,
    exercises: input.exercises,
    ladders: input.ladders,
    seed: input.seed,
    todayFor: (w, week) => (w === input.fromWeek ? input.today : (week?.windowStart ?? input.today)),
    logWeek: (week) => asWrittenLogs(week),
    historyFor: (w, history) =>
      w === input.fromWeek ? history : { ...history, sorenessToday: null, fingerPainToday: null },
  };
  if (input.generatedAt !== undefined) options.generatedAt = input.generatedAt;
  if (input.priorLogs !== undefined) options.priorLogs = input.priorLogs;
  return options;
}

/**
 * Project weeks `fromWeek` to `toWeek`, in order, each fed the one before it.
 * Synchronous and whole-range; a caller that wants to paint between weeks folds
 * `stepWeekChain` over `projectionStart` and `projectionOptions` instead.
 */
export function projectWeeks(input: ProjectionInput): ProjectedProgram {
  const options = projectionOptions(input);
  const start = projectionStart(input);
  const end = runWeekChain(start, input.fromWeek, lastWeek(input), options);
  return {
    weeks: end.weeks,
    logs: end.setLogs.slice(start.setLogs.length),
    sessions: end.sessions.slice(start.sessions.length),
    history: end.history,
    skeleton: end.skeleton,
  };
}
