/**
 * Jump readiness from the optional RSI-mode drop-jump test (brief section 08
 * "Jump readiness", section 10 "OVR Jump").
 *
 * Reps over 250 ms are non-reactive and excluded from the average; they are
 * counted and reported, never silently dropped. Mean and best are computed in
 * the app rather than read off the device. Rolling baselines, never single
 * reps, feed the ladder rule, and the contact-time noise band is wider than
 * the height band: the only third-party comparison found errors of roughly
 * 10 ms low to 25 ms high.
 */
import type { JumpTest, JumpRep } from '../types/analytics.js';
import type { LocalDate } from '../types/calendar.js';
import { mmToIn } from '../units.js';
import { sampleSd } from './noise.js';

/** Contact time over this is non-reactive and leaves the average. */
export const NON_REACTIVE_GCT_MS = 250;

/** The published third-party contact-time error band, in milliseconds. */
export const CONTACT_TIME_ERROR_MS = { low: -10, high: 25 } as const;

/** One session's readiness numbers. */
export interface JumpReadinessStats {
  testId: string;
  date: LocalDate;
  boxHeightIn: number | null;
  /** Reps that counted: unflagged, with a contact time at or under 250 ms. */
  reactiveReps: number;
  /** Unflagged reps excluded because contact time was over 250 ms. */
  nonReactiveReps: number;
  meanRsi: number | null;
  bestRsi: number | null;
  meanGctMs: number | null;
  bestGctMs: number | null;
  meanHeightIn: number | null;
  bestHeightIn: number | null;
  /** Within-session spread of RSI, the honest error bar on one session. */
  rsiSd: number | null;
}

/** A rolling baseline over the last few sessions. */
export interface ReadinessBaseline {
  sessions: number;
  meanRsi: number | null;
  meanGctMs: number | null;
  meanHeightIn: number | null;
}

/** RSI the app computes: height in metres over contact time in seconds. */
export function computeRsi(rep: JumpRep): number | null {
  if (rep.gctMs === undefined || rep.gctMs <= 0) return null;
  return rep.heightMm / 1000 / (rep.gctMs / 1000);
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** One RSI-mode session reduced to its readiness numbers. */
export function jumpReadiness(
  test: JumpTest,
  nonReactiveGctMs = NON_REACTIVE_GCT_MS,
): JumpReadinessStats {
  const unflagged = test.reps.filter((rep) => !rep.flagged);
  const timed = unflagged.filter((rep) => typeof rep.gctMs === 'number');
  const reactive = timed.filter((rep) => (rep.gctMs ?? 0) <= nonReactiveGctMs);

  const rsis: number[] = [];
  const gcts: number[] = [];
  const heights: number[] = [];
  for (const rep of reactive) {
    const rsi = rep.rsiCalc ?? computeRsi(rep);
    if (rsi !== null && rsi !== undefined) rsis.push(rsi);
    if (typeof rep.gctMs === 'number') gcts.push(rep.gctMs);
    heights.push(mmToIn(rep.heightMm));
  }

  return {
    testId: test.id,
    date: test.date,
    boxHeightIn: test.boxHeightIn ?? null,
    reactiveReps: reactive.length,
    nonReactiveReps: timed.length - reactive.length,
    meanRsi: average(rsis),
    bestRsi: rsis.length === 0 ? null : Math.max(...rsis),
    meanGctMs: average(gcts),
    bestGctMs: gcts.length === 0 ? null : Math.min(...gcts),
    meanHeightIn: average(heights),
    bestHeightIn: heights.length === 0 ? null : Math.max(...heights),
    rsiSd: rsis.length < 2 ? null : sampleSd(rsis),
  };
}

/**
 * The rolling baseline the ladder rule reads: the mean of the last `window`
 * sessions' means. Single reps never feed the ladder.
 */
export function readinessBaseline(
  tests: readonly JumpTest[],
  window = 3,
  nonReactiveGctMs = NON_REACTIVE_GCT_MS,
): ReadinessBaseline {
  const stats = tests
    .map((test) => jumpReadiness(test, nonReactiveGctMs))
    .filter((entry) => entry.reactiveReps > 0)
    .slice(-window);
  return {
    sessions: stats.length,
    meanRsi: average(collect(stats.map((entry) => entry.meanRsi))),
    meanGctMs: average(collect(stats.map((entry) => entry.meanGctMs))),
    meanHeightIn: average(collect(stats.map((entry) => entry.meanHeightIn))),
  };
}

function collect(values: readonly (number | null)[]): number[] {
  return values.filter((value): value is number => value !== null);
}
