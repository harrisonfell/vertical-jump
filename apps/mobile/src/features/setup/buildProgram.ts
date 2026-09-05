/**
 * Build the program: run the engine over the athlete's answers.
 *
 * `buildProgramPlan` is pure. It runs `planSkeleton` and then
 * `materializeWeek(1)`, which asserts its own invariants and throws
 * `WeekInvariantError` when a rule refused, or `GenerationBlockedError` when
 * the self-screen blocks generation. Nothing is written until it returns, so a
 * refused program leaves the database exactly as it was.
 *
 * The writing half lives in `writeProgram.ts`, so this module reaches nothing
 * but the engine and can be run over an athlete row without a database.
 */
import {
  GenerationBlockedError,
  RULESET_V1,
  WeekInvariantError,
  loadExercises,
  materializeWeek,
  planSkeleton,
} from '@vert/engine';
import type {
  Athlete as EngineAthlete,
  MaterializeContext,
  MaterializeHistory,
  PlanSkeleton,
  WeekPlan,
} from '@vert/engine';
import type { Athlete, LocalDate, PainStatus } from '@/data';
import { programBuiltLine } from './copy';
import { toEngineAthlete, type BaselineReading } from './engineAthlete';

export { GenerationBlockedError, WeekInvariantError };

/**
 * The program's seed. Derived from the answers that shape it, so rebuilding
 * the same program twice gives byte-identical output and a screenshot never
 * drifts. Never `Math.random`: the engine is pure and stays that way.
 */
export function seedFor(athlete: EngineAthlete, programStart: LocalDate): number {
  const source = `${programStart}|${athlete.targetDate}|${athlete.daysPerWeek}|${athlete.weekdays.join(',')}`;
  let hash = 2_166_136_261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

/** A first program has no history: nothing has been logged yet. */
export function emptyHistory(): MaterializeHistory {
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

export interface BuildInput {
  readonly athlete: Athlete;
  readonly pains: readonly PainStatus[];
  readonly baseline: BaselineReading | null;
  readonly today: LocalDate;
  /** Frozen into the snapshot. The screen passes the real instant. */
  readonly generatedAt: string;
}

export interface BuildPlan {
  readonly skeleton: PlanSkeleton;
  readonly week1: WeekPlan;
  readonly seed: number;
  /** The exact "Program built: ..." line the summary sheet shows. */
  readonly builtLine: string;
  readonly rulesetVersion: string;
}

/** Run the engine. Pure: it reads nothing and writes nothing. */
export function buildProgramPlan(input: BuildInput): BuildPlan {
  const athlete = toEngineAthlete({
    athlete: input.athlete,
    pains: input.pains,
    baseline: input.baseline,
  });
  const ruleset = RULESET_V1;
  const { exercises, ladders } = loadExercises();
  const skeleton = planSkeleton(athlete, input.today, ruleset);
  const seed = seedFor(athlete, skeleton.programStart);

  const context: MaterializeContext = {
    athlete,
    ruleset,
    exercises,
    ladders,
    skeleton,
    w: 1,
    workingMaxes: athlete.workingMaxes,
    history: emptyHistory(),
    today: input.today,
    seed,
    generatedAt: input.generatedAt,
  };
  const week1 = materializeWeek(context);

  const firstWeek = skeleton.weeks[0];
  const lastWeek = skeleton.weeks[skeleton.weeks.length - 1];
  const testSession = firstWeek?.sessions.find((session) => session.isTestDay);
  const lastSessions = lastWeek?.sessions ?? [];
  const lastSession = lastSessions[lastSessions.length - 1];

  return {
    skeleton,
    week1,
    seed,
    rulesetVersion: week1.snapshot.rulesetVersion,
    builtLine: programBuiltLine({
      weeks: skeleton.W,
      daysPerWeek: skeleton.daysPerWeek,
      week1Start: firstWeek?.sessions[0]?.date ?? skeleton.programStart,
      firstTestDate: testSession?.date ?? null,
      peakEnd: lastSession?.date ?? skeleton.targetDate,
    }),
  };
}

/** The refusal a failed rule shows, in plain words, with nothing saved. */
export function buildFailureLines(error: unknown): readonly string[] {
  if (error instanceof WeekInvariantError) return [error.message];
  if (error instanceof Error) return [error.message];
  return ['Something in your answers made the program impossible to build.'];
}
