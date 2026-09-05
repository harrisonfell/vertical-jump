/**
 * Theil-Sen: the median of all pairwise slopes. Chosen over least squares
 * because a single flagged attempt or a bad-shoes day cannot drag the line
 * (brief section 08 "Primary chart": trend from 3 tests over the observed
 * range).
 *
 * The range beside the slope is one standard error, built without a bootstrap
 * so the result is exactly reproducible: SE = sd / sqrt(sum of (x - xbar)^2),
 * where sd is the residual SD after `noiseSd` has applied the 0.6 in floor.
 * Until eight canonical tests exist the floor is doing the work, so the range
 * never claims a precision the data has not earned.
 */
import type { TrendPoint, TrendResult } from '../types/analytics.js';
import { at } from './format.js';
import { noiseSd } from './noise.js';

/**
 * Fit a trend over canonical tests. Points carry weeks since program start and
 * the value in inches. The residual SD is floored until eight tests exist, so
 * the reported range never claims a precision it has not earned.
 */
export function theilSen(
  points: TrendPoint[],
  residualSdFloorIn = 0.6,
  testsBeforeUnfloored = 8,
): TrendResult {
  const n = points.length;
  if (n < 2) throw new RangeError('theilSen needs at least two points');

  const slopes: number[] = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const a = points[i];
      const b = points[j];
      if (a === undefined || b === undefined) continue;
      const dx = b.weeks - a.weeks;
      if (dx === 0) continue;
      slopes.push((b.valueIn - a.valueIn) / dx);
    }
  }
  if (slopes.length === 0) {
    throw new RangeError('theilSen needs at least two distinct x values');
  }

  const slopeInPerWk = median(slopes);
  const interceptIn = median(points.map((p) => p.valueIn - slopeInPerWk * p.weeks));
  const resid = residuals(points, slopeInPerWk, interceptIn);
  const { sdIn, floored } = noiseSd(resid, n, residualSdFloorIn, testsBeforeUnfloored);

  const meanX = points.reduce((sum, p) => sum + p.weeks, 0) / n;
  const sxx = points.reduce((sum, p) => sum + (p.weeks - meanX) ** 2, 0);
  const standardError = sxx > 0 ? sdIn / Math.sqrt(sxx) : sdIn;

  return {
    slopeInPerWk,
    low: slopeInPerWk - standardError,
    high: slopeInPerWk + standardError,
    n,
    method: 'theil_sen',
    residualSdIn: sdIn,
    sdFloored: floored,
    interceptIn,
  };
}

/** The median of a numeric list. Throws on an empty list. */
export function median(values: number[]): number {
  if (values.length === 0) throw new RangeError('median of an empty list');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  if (sorted.length % 2 === 1) return at(sorted, middle);
  return (at(sorted, middle - 1) + at(sorted, middle)) / 2;
}

/** Residuals of the points about the fitted line, in inches. */
export function residuals(
  points: TrendPoint[],
  slopeInPerWk: number,
  interceptIn: number,
): number[] {
  return points.map((p) => p.valueIn - (interceptIn + slopeInPerWk * p.weeks));
}

/** The fitted value in inches at a given number of weeks since program start. */
export function fittedAt(trend: TrendResult, weeks: number): number {
  return trend.interceptIn + trend.slopeInPerWk * weeks;
}

/** One standard error of the slope, the half-width of the reported range. */
export function slopeStandardError(trend: TrendResult): number {
  return (trend.high - trend.low) / 2;
}
