/**
 * The noise floor. The residual SD is floored at 0.6 in until eight tests
 * exist (brief section 08), so a two-test trend can never claim a precision it
 * has not earned. Contact-time noise is wider than height noise: the only
 * third-party comparison found errors of roughly 10 ms low to 25 ms high.
 */
import type { JumpTest } from '../types/analytics.js';
import { mmToIn } from '../units.js';
import { sessionBestMm, sessionRepsMm } from './sessionBest.js';

/** Sample standard deviation of a list. Returns 0 for fewer than two values. */
export function sampleSd(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const sumSquares = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  return Math.sqrt(sumSquares / (n - 1));
}

/**
 * The residual SD to report, floored until `testsBeforeUnfloored` tests exist.
 * Reports whether the floor was the binding value so Progress can say so.
 */
export function noiseSd(
  residualsIn: number[],
  n: number,
  floorIn = 0.6,
  testsBeforeUnfloored = 8,
): { sdIn: number; floored: boolean } {
  const sd = sampleSd(residualsIn);
  if (n >= testsBeforeUnfloored) return { sdIn: sd, floored: false };
  if (sd < floorIn) return { sdIn: floorIn, floored: true };
  return { sdIn: sd, floored: false };
}

/**
 * SD of session-best height across sessions, in inches. This is the raw spread
 * of the bests, so on a rising stream it measures the climb, not the noise:
 * the PR threshold reads `calibrationSpread` instead (house rule
 * read.pr_noise_residual). Kept for the chart's descriptive note.
 */
export function sessionBestSdIn(tests: JumpTest[]): number | null {
  const bests: number[] = [];
  for (const test of tests) {
    const best = sessionBestMm(test);
    if (best !== null) bests.push(mmToIn(best));
  }
  if (bests.length < 2) return null;
  return sampleSd(bests);
}

/**
 * Within-session spread from the attempts themselves, in inches. This is the
 * noise note the test sheet shows at one and two tests, before any trend
 * exists (brief section 06, "1 to 2 tests").
 */
export function withinSessionSpreadIn(test: JumpTest): number | null {
  const reps = sessionRepsMm(test).map(mmToIn);
  if (reps.length < 2) return null;
  return sampleSd(reps);
}

/**
 * The attempt spread inside one session, in inches: the best attempt minus the
 * worst, both unflagged. This is the raw instrument-and-athlete noise of a
 * single sitting, and the calibration spread at three sessions.
 */
export function withinSessionRangeIn(test: JumpTest): number | null {
  const reps = sessionRepsMm(test).map(mmToIn);
  if (reps.length < 2) return null;
  return Math.max(...reps) - Math.min(...reps);
}

/**
 * The mean within-session attempt spread across sessions, in inches. Sessions
 * with one attempt carry no spread and are left out; null when none of them
 * has two attempts.
 */
export function meanWithinSessionRangeIn(tests: readonly JumpTest[]): number | null {
  const ranges: number[] = [];
  for (const test of tests) {
    const range = withinSessionRangeIn(test);
    if (range !== null) ranges.push(range);
  }
  if (ranges.length === 0) return null;
  return ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
}
