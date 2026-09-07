/**
 * What the build screen's progress bar knows.
 *
 * A build is two phases and one bar. First the rule book runs, a week at a
 * time, with a paint awaited between weeks; then the writes land, one awaited
 * statement each. Both advance the same running `done`, so the bar never
 * restarts halfway.
 *
 * The step count comes from the skeleton, which is known before the first week
 * is materialized: one materialize step a week, one program row, one week row
 * a week, and one step per session of every week. Determinate, never a spinner.
 */
import type { PlanSkeleton } from '@vert/engine';
import { SETUP_COPY } from './copy';

/** One unit of work the build has just finished. */
export type WriteStep =
  | { readonly kind: 'materialize'; readonly w: number; readonly of: number }
  | { readonly kind: 'program' }
  | { readonly kind: 'week'; readonly w: number; readonly of: number }
  | { readonly kind: 'session'; readonly w: number; readonly n: number; readonly of: number };

export interface WriteProgress {
  readonly done: number;
  readonly total: number;
  readonly step: WriteStep;
}

export type WriteProgressListener = (progress: WriteProgress) => void;

/**
 * The only shape either count reads: weeks, each with its sessions. Structural
 * rather than `BuildPlan` so this module imports nothing from `buildProgram`,
 * which imports `buildStepCount` from here.
 */
interface WeeksWithSessions {
  readonly weeks: readonly { readonly sessions: readonly unknown[] }[];
}

/** Every session of every week. */
function sessionCount(plan: WeeksWithSessions): number {
  return plan.weeks.reduce((count, week) => count + week.sessions.length, 0);
}

/**
 * Every step of a whole build, materializing and writing.
 *
 * Known from the skeleton alone: `materializeWeek` maps over the skeleton
 * week's sessions and never adds or drops one, so the session total it will
 * write is the session total the skeleton already names.
 */
export function buildStepCount(skeleton: PlanSkeleton): number {
  return (
    skeleton.weeks.length + // one materialize step a week
    1 + // the program row
    skeleton.weeks.length + // one week row a week
    sessionCount(skeleton) // every session of every week
  );
}

/** How many awaited writes `writeProgramPlan` makes for this plan. */
export function writeStepCount(plan: WeeksWithSessions): number {
  return 1 + plan.weeks.length + sessionCount(plan);
}

/** The state the screen holds while a build runs. */
export interface BuildProgress {
  readonly done: number;
  /** Null until the skeleton is planned: only it knows the step count. */
  readonly total: number | null;
  /** "Writing week 4 of 12". Computed from the work, never a slogan. */
  readonly line: string;
}

/** The bar before the skeleton exists: an empty track and a true label. */
export const RULE_BOOK_PROGRESS: BuildProgress = {
  done: 0,
  total: null,
  line: SETUP_COPY.buildRuleBook,
};

/** The line a finished step earns. One format per step kind. */
export function writeStepLine(step: WriteStep): string {
  switch (step.kind) {
    case 'materialize':
      return `${SETUP_COPY.buildBuildingWeek} ${step.w} of ${step.of}`;
    case 'program':
      return SETUP_COPY.buildSavingProgram;
    case 'week':
      return `${SETUP_COPY.buildWritingWeek} ${step.w} of ${step.of}`;
    case 'session':
      return `${SETUP_COPY.buildWritingWeek} ${step.w}, ${SETUP_COPY.buildSessionWord} ${step.n} of ${step.of}`;
  }
}

export function progressFromWrite(progress: WriteProgress): BuildProgress {
  return { done: progress.done, total: progress.total, line: writeStepLine(progress.step) };
}

/** 0 to 1 for the bar. Zero while the total is unknown. */
export function progressFraction(progress: BuildProgress): number {
  if (progress.total === null || progress.total <= 0) return 0;
  return Math.min(1, Math.max(0, progress.done / progress.total));
}
