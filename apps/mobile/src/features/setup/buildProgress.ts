/**
 * What the build screen's progress bar knows.
 *
 * The rule book runs synchronously, so nothing can move while it does; the
 * writes that follow are one awaited statement each, so each one can advance
 * the bar. The step count comes from the plan itself: one program row, every
 * week of the skeleton, every week-1 session. Determinate, never a spinner.
 */
import type { BuildPlan } from './buildProgram';
import { SETUP_COPY } from './copy';

/** One write the program writer has just finished. */
export type WriteStep =
  | { readonly kind: 'program' }
  | { readonly kind: 'week'; readonly w: number; readonly of: number }
  | { readonly kind: 'session'; readonly n: number; readonly of: number };

export interface WriteProgress {
  readonly done: number;
  readonly total: number;
  readonly step: WriteStep;
}

export type WriteProgressListener = (progress: WriteProgress) => void;

/** How many awaited writes `writeProgramPlan` makes for this plan. */
export function writeStepCount(plan: BuildPlan): number {
  return 1 + plan.skeleton.weeks.length + plan.week1.sessions.length;
}

/** The state the screen holds while a build runs. */
export interface BuildProgress {
  readonly done: number;
  /** Null until the rule book has run: only the plan knows the step count. */
  readonly total: number | null;
  /** "Writing week 4 of 12". Computed from the work, never a slogan. */
  readonly line: string;
}

/** The bar before the engine has returned: an empty track and a true label. */
export const RULE_BOOK_PROGRESS: BuildProgress = {
  done: 0,
  total: null,
  line: SETUP_COPY.buildRuleBook,
};

/** The line a finished write earns. One format per step kind. */
export function writeStepLine(step: WriteStep): string {
  switch (step.kind) {
    case 'program':
      return SETUP_COPY.buildSavingProgram;
    case 'week':
      return `${SETUP_COPY.buildWritingWeek} ${step.w} of ${step.of}`;
    case 'session':
      return `${SETUP_COPY.buildWritingSession} ${step.n} of ${step.of}`;
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
