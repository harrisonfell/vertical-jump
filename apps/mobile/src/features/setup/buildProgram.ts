/**
 * Build the program: run the engine over the athlete's answers.
 *
 * `buildProgramPlan` is pure. It runs `planSkeleton` and then projects every
 * week 1..W: week 1 from the athlete's answers, each later week fed the one
 * before it under the assumption that week went exactly as written. Any of
 * them can throw `WeekInvariantError` when a rule refused, or
 * `GenerationBlockedError` when the self-screen blocks generation. Nothing is
 * written until the whole projection returns, so a refused program leaves the
 * database exactly as it was.
 *
 * `buildProgramWeeks` is the same work, folded a week at a time so the build
 * screen can paint between weeks. The engine never becomes asynchronous.
 *
 * The writing half lives in `writeProgram.ts`, so this module reaches nothing
 * but the engine and can be run over an athlete row without a database.
 */
import {
  GenerationBlockedError,
  RULESET_V1,
  WeekInvariantError,
  emptyMaterializeHistory,
  loadExercises,
  planSkeleton,
  projectWeeks,
  projectionOptions,
  projectionStart,
  stepWeekChain,
} from '@vert/engine';
import type {
  Athlete as EngineAthlete,
  PlanSkeleton,
  ProjectionInput,
  WeekPlan,
} from '@vert/engine';
import type { Athlete, LocalDate, PainStatus } from '@/data';
import { buildStepCount } from './buildProgress';
import { programBuiltLine } from './copy';
import { toEngineAthlete, type BaselineReading } from './engineAthlete';

export { GenerationBlockedError, WeekInvariantError };

/** A first program has no history: nothing has been logged yet. */
export const emptyHistory = emptyMaterializeHistory;

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

export interface BuildInput {
  readonly athlete: Athlete;
  readonly pains: readonly PainStatus[];
  readonly baseline: BaselineReading | null;
  readonly today: LocalDate;
  /**
   * The instant the build ran. It stamps the week rows' `generated_at`, so the
   * database is honest about when the program was written.
   *
   * It is deliberately NOT handed to the engine. `frozenAtFor` would then use
   * one instant as the `asOf` for every projected week, and `bestEpley` drops
   * any log dated after `asOf`, so weeks 2..W would never see the sets the
   * projection just synthesized for the weeks before them. Left unset, the
   * engine freezes each week at its own `windowStart`, which is both pure and
   * the value the four-week lookback needs.
   */
  readonly generatedAt: string;
}

export interface BuildPlan {
  /** The skeleton as planned. The Plan's calendar reads this. */
  readonly skeleton: PlanSkeleton;
  /** Weeks 1..W, in order. Week 1 is materialized; the rest are projected. */
  readonly weeks: readonly WeekPlan[];
  /** Week 1, identical to `weeks[0]`. Kept for the summary sheet. */
  readonly week1: WeekPlan;
  readonly seed: number;
  /** The exact "Program built: ..." line the summary sheet shows. */
  readonly builtLine: string;
  readonly rulesetVersion: string;
  /** The instant the week rows are stamped with. */
  readonly generatedAt: string;
}

/** Everything both build paths compute before a single week is materialized. */
interface Prepared {
  readonly skeleton: PlanSkeleton;
  readonly seed: number;
  readonly projection: ProjectionInput;
}

function prepare(input: BuildInput): Prepared {
  const athlete = toEngineAthlete({
    athlete: input.athlete,
    pains: input.pains,
    baseline: input.baseline,
  });
  const ruleset = RULESET_V1;
  const { exercises, ladders } = loadExercises();
  const skeleton = planSkeleton(athlete, input.today, ruleset);
  const seed = seedFor(athlete, skeleton.programStart);

  return {
    skeleton,
    seed,
    projection: {
      athlete,
      ruleset,
      exercises,
      ladders,
      skeleton,
      seed,
      today: input.today,
      fromWeek: 1,
      toWeek: skeleton.W,
      workingMaxes: athlete.workingMaxes,
    },
  };
}

/** The plan the screens read, once every week has been materialized. */
function planFrom(input: BuildInput, prepared: Prepared, weeks: readonly WeekPlan[]): BuildPlan {
  const { skeleton } = prepared;
  const week1 = weeks[0];
  if (week1 === undefined) throw new Error('The rule book returned no weeks.');

  const firstWeek = skeleton.weeks[0];
  const lastWeek = skeleton.weeks[skeleton.weeks.length - 1];
  const testSession = firstWeek?.sessions.find((session) => session.isTestDay);
  const lastSessions = lastWeek?.sessions ?? [];
  const lastSession = lastSessions[lastSessions.length - 1];

  return {
    skeleton,
    weeks,
    week1,
    seed: prepared.seed,
    rulesetVersion: week1.snapshot.rulesetVersion,
    generatedAt: input.generatedAt,
    builtLine: programBuiltLine({
      weeks: skeleton.W,
      daysPerWeek: skeleton.daysPerWeek,
      week1Start: firstWeek?.sessions[0]?.date ?? skeleton.programStart,
      firstTestDate: testSession?.date ?? null,
      peakEnd: lastSession?.date ?? skeleton.targetDate,
    }),
  };
}

/** Run the engine over every week. Pure: it reads nothing and writes nothing. */
export function buildProgramPlan(input: BuildInput): BuildPlan {
  const prepared = prepare(input);
  return planFrom(input, prepared, projectWeeks(prepared.projection).weeks);
}

/**
 * The same build, one week at a time.
 *
 * `onWeek` fires after each week is materialized and `yieldBetween` is awaited
 * after it, so the screen's bar can move rather than freeze on one label for
 * the whole run. The engine stays synchronous: this folds its own step
 * function, it does not make the rule book async.
 *
 * `onWeek`'s third argument is the whole build's step count, materializing and
 * writing, known as soon as the skeleton is planned. The screen needs it to
 * draw a determinate bar from the very first week rather than from the first
 * write.
 */
export async function buildProgramWeeks(
  input: BuildInput,
  onWeek?: (w: number, of: number, totalSteps: number) => void,
  yieldBetween: () => Promise<void> = () => Promise.resolve(),
): Promise<BuildPlan> {
  const prepared = prepare(input);
  const options = projectionOptions(prepared.projection);
  const of = prepared.skeleton.W;
  const totalSteps = buildStepCount(prepared.skeleton);
  let state = projectionStart(prepared.projection);

  for (let w = 1; w <= of; w += 1) {
    state = stepWeekChain(state, w, options);
    onWeek?.(w, of, totalSteps);
    await yieldBetween();
  }

  return planFrom(input, prepared, state.weeks);
}

/** The refusal a failed rule shows, in plain words, with nothing saved. */
export function buildFailureLines(error: unknown): readonly string[] {
  if (error instanceof WeekInvariantError) return [error.message];
  if (error instanceof Error) return [error.message];
  return ['Something in your answers made the program impossible to build.'];
}
