/**
 * The dashed projection band, drawn only from six tests. Dash is reserved for
 * projection (brief section 08 "Primary chart"): nothing else in the app is
 * dashed, so a dashed line always means "this has not happened yet".
 *
 * The band is the trend's own range carried forward: the two lines that share
 * the fit's intercept and carry the low and high slopes. It is the set of
 * trend lines the data cannot distinguish, read at the target date, so a wide
 * band always means "not enough tests yet" rather than "bad news".
 */
import type { LocalDate } from '../types/calendar.js';
import type { ProjectionResult, TrendPoint, TrendResult } from '../types/analytics.js';
import { diffDays } from '../calendar.js';
import { fittedAt } from './theilSen.js';

/**
 * Project the trend to the target date with a band from the residual SD.
 * Returns null with fewer than `minTests` canonical tests.
 */
export function projection(
  points: TrendPoint[],
  trend: TrendResult,
  targetDate: LocalDate,
  programStart: LocalDate,
  minTests = 6,
): ProjectionResult | null {
  if (points.length < minTests) return null;
  if (points[points.length - 1] === undefined) return null;

  const targetWeeks = diffDays(programStart, targetDate) / 7;
  const atTargetIn = fittedAt(trend, targetWeeks);
  const edgeA = trend.interceptIn + trend.low * targetWeeks;
  const edgeB = trend.interceptIn + trend.high * targetWeeks;

  return {
    atTargetIn,
    lowIn: Math.min(edgeA, edgeB),
    highIn: Math.max(edgeA, edgeB),
    n: points.length,
    targetDate,
  };
}

/**
 * Required pace, fixed at program start: goal minus baseline over program
 * weeks. The grey line on the chart.
 */
export function requiredPaceInPerWk(
  baselineIn: number,
  goalIn: number,
  programWeeks: number,
): number {
  if (programWeeks <= 0) return goalIn - baselineIn;
  return (goalIn - baselineIn) / programWeeks;
}

/**
 * Remaining pace: goal minus latest over weeks left. With no weeks left the
 * remaining pace is the whole gap, which is the honest reading of "you have
 * one week or less to cover this".
 */
export function remainingPaceInPerWk(
  latestIn: number,
  goalIn: number,
  weeksLeft: number,
): number {
  if (weeksLeft <= 0) return goalIn - latestIn;
  return (goalIn - latestIn) / weeksLeft;
}
