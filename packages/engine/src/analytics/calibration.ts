/**
 * The calibration spread: how far a number moves when nothing real has
 * changed. It is the input to the PR threshold, so it has to measure the
 * instrument and the athlete, never the training.
 *
 * The raw standard deviation of session bests does not measure that. On a
 * rising stream it measures the climb, so a threshold built from it grows with
 * every good test until no PR can fire (house rule read.pr_noise_residual).
 * The spread is therefore taken around the Theil-Sen trend of the session
 * bests, which is flat by construction. With three sessions there is no trend
 * worth fitting, so the attempts inside each session carry the answer instead.
 * Nothing may read finer than the device: the spread is floored at 0.1 in.
 */
import type { JumpTest, TrendPoint } from '../types/analytics.js';
import type { LocalDate } from '../types/calendar.js';
import { diffDays } from '../calendar.js';
import { mmToIn } from '../units.js';
import { meanWithinSessionRangeIn, sampleSd } from './noise.js';
import { sessionBestMm } from './sessionBest.js';
import { residuals, theilSen } from './theilSen.js';

/** The OVR Jump reads in 0.1 in steps, so 2.54 mm is the finest real spread. */
export const DEVICE_RESOLUTION_MM = 2.54;

/** The same step in inches, the floor every calibration spread carries. */
export const DEVICE_RESOLUTION_IN = 0.1;

/** Sessions needed before the spread is taken around a trend. */
export const SESSIONS_FOR_TREND = 4;

/** How the spread was measured, in the words the copy needs. */
export type SpreadBasis = 'trend' | 'mean' | 'attempts';

/** The measured spread, with enough of its provenance to explain itself. */
export interface CalibrationSpread {
  /** The spread in inches, floored at the device resolution. */
  spreadIn: number;
  /** Residual around a fit, or the attempts inside the sessions. */
  method: 'residual' | 'within_session';
  /** What the residual was taken around, or that it came from attempts. */
  basis: SpreadBasis;
  /** True when the device resolution, not the data, set the number. */
  floored: boolean;
  /** Sessions the spread was measured from. */
  sessions: number;
}

/**
 * Session bests as trend points, with weeks counted from the first session in
 * the list. The origin is local to the stream: no program start is needed to
 * measure noise.
 */
export function sessionBestPoints(tests: readonly JumpTest[]): TrendPoint[] {
  const points: TrendPoint[] = [];
  let origin: LocalDate | null = null;
  for (const test of tests) {
    const best = sessionBestMm(test);
    if (best === null) continue;
    if (origin === null) origin = test.date;
    points.push({
      weeks: diffDays(origin, test.date) / 7,
      valueIn: mmToIn(best),
      date: test.date,
    });
  }
  return points;
}

/**
 * The spread to calibrate a PR threshold from, or null when two session bests
 * do not yet exist. Four sessions with two distinct dates give the residual SD
 * around the trend; three fall back to the mean within-session attempt spread,
 * and to the residual SD around the mean when the attempts are not there.
 */
export function calibrationSpread(
  tests: readonly JumpTest[],
  sessionsForTrend = SESSIONS_FOR_TREND,
): CalibrationSpread | null {
  const points = sessionBestPoints(tests);
  const sessions = points.length;
  if (sessions < 2) return null;

  if (sessions >= sessionsForTrend && distinctWeeks(points) >= 2) {
    const trend = theilSen(points);
    const resid = residuals(points, trend.slopeInPerWk, trend.interceptIn);
    return floorAtResolution(sampleSd(resid), 'residual', 'trend', sessions);
  }

  const attempts = meanWithinSessionRangeIn(tests);
  if (attempts !== null) {
    return floorAtResolution(attempts, 'within_session', 'attempts', sessions);
  }

  const bests = points.map((point) => point.valueIn);
  return floorAtResolution(sampleSd(bests), 'residual', 'mean', sessions);
}

/** Distinct x values, since a fit needs two of them. */
function distinctWeeks(points: readonly TrendPoint[]): number {
  return new Set(points.map((point) => point.weeks)).size;
}

/** No spread reads finer than the device that produced the numbers. */
function floorAtResolution(
  measuredIn: number,
  method: CalibrationSpread['method'],
  basis: SpreadBasis,
  sessions: number,
): CalibrationSpread {
  const floored = measuredIn < DEVICE_RESOLUTION_IN;
  return {
    spreadIn: floored ? DEVICE_RESOLUTION_IN : measuredIn,
    method,
    basis,
    floored,
    sessions,
  };
}
