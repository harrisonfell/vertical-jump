import type { ReadinessMetric, ReadinessTestConfig } from '@vert/engine';
import { formatReadinessValue, readinessTestNoun } from '@vert/engine';
import type { DraftIssue } from './validate';

/**
 * The readiness throw: channel B of the gate (house rule
 * `house.sc.readiness_gate`).
 *
 * The test is configuration rather than a constant, so the sheet reads the
 * kind, the metric and the attempt count off the athlete's own config: the
 * default is a seated med-ball throw in metres, and a CMJ or an RSI drop jump
 * are the alternates. The day's number is the best attempt, derived here and
 * never typed twice.
 *
 * The bounds are the throw's own, not a device's: a seated med-ball throw that
 * reads under a metre or past twenty is a mis-typed number, so it blocks the
 * save and says which it is.
 */

export const THROW_MIN_M = 1;
export const THROW_MAX_M = 20;
export const THROW_STEP_M = 0.1;

/** The unit the engine prints after a reading. RSI is a ratio and carries none. */
export function throwUnit(metric: ReadinessMetric): string {
  if (metric === 'distance_m') return 'm';
  if (metric === 'height_in') return 'in';
  return '';
}

/** The unit string stored beside the row: "m", "in", "RSI". */
export function storedUnit(metric: ReadinessMetric): string {
  return metric === 'rsi' ? 'RSI' : throwUnit(metric);
}

/**
 * The bare number an editable field shows, with the unit left to the stepper's
 * own suffix. Sliced off the engine's own reading rather than re-rounded, so
 * the field and the summary can never disagree about a decimal.
 */
export function formatThrowValue(value: number, metric: ReadinessMetric): string {
  const unit = throwUnit(metric);
  const text = formatReadinessValue(value, metric);
  return unit === '' ? text : text.slice(0, text.length - unit.length - 1);
}

/** The step one metric moves by: 0.1 m, 0.1 in, or 0.01 RSI. */
export function throwStep(metric: ReadinessMetric): number {
  return metric === 'rsi' ? 0.01 : THROW_STEP_M;
}

export interface ThrowReading {
  readonly issues: readonly DraftIssue[];
  readonly canSave: boolean;
  /** The best attempt, in the metric's own unit. */
  readonly best: number | null;
  readonly counted: number;
  /** "Best 7.2 m · 3 attempts", or the honest short form. */
  readonly summary: string;
}

/** The bounds a metric is read against. Only distance has a device-free floor. */
function boundsFor(metric: ReadinessMetric): { readonly min: number; readonly max: number } {
  if (metric === 'distance_m') return { min: THROW_MIN_M, max: THROW_MAX_M };
  if (metric === 'height_in') return { min: 6, max: 60 };
  return { min: 0.1, max: 5 };
}

/**
 * Read a readiness-test draft: the issues, the best attempt, and whether Save
 * is on. An untyped row is not an attempt, so three rows with one number in
 * them is a one-attempt test and saves as one.
 */
export function readThrow(
  attempts: readonly (number | null)[],
  config: ReadinessTestConfig,
): ThrowReading {
  const issues: DraftIssue[] = [];
  const counted: number[] = [];
  const noun = readinessTestNoun(config.kind);
  const { min, max } = boundsFor(config.metric);

  attempts.forEach((value, index) => {
    if (value === null) return;
    if (!Number.isFinite(value) || value < min || value > max) {
      issues.push({
        index,
        blocking: true,
        message: `Attempt ${index + 1} reads ${formatReadinessValue(value, config.metric)}. A ${noun} reads between ${formatReadinessValue(min, config.metric)} and ${formatReadinessValue(max, config.metric)}. Check the number.`,
      });
      return;
    }
    counted.push(value);
  });

  if (counted.length === 0) {
    issues.push({
      index: null,
      blocking: true,
      message: `Enter at least one ${noun}.`,
    });
  }

  const best = counted.length === 0 ? null : Math.max(...counted);
  return {
    issues,
    canSave: !issues.some((issue) => issue.blocking),
    best,
    counted: counted.length,
    summary:
      best === null
        ? `No ${noun} counted yet.`
        : `Best ${formatReadinessValue(best, config.metric)} · ${counted.length} ${counted.length === 1 ? 'attempt' : 'attempts'}`,
  };
}

/** The attempts a save writes: the typed ones, in order. */
export function throwAttempts(attempts: readonly (number | null)[]): number[] {
  return attempts.filter((value): value is number => value !== null && Number.isFinite(value));
}
