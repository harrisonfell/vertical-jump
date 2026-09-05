/**
 * Chart geometry for the primary instrument stream (brief section 08 "Primary
 * chart"). One chart per stream, never overlaid.
 *
 * X domain is fixed from program start to target date. Y domain is fixed at
 * [min(baseline, tests) - 2, max(goal, tests) + 2] in whole inches and does
 * not rescale as data arrives: a test inside the frame leaves the frame alone.
 * Gaps over 21 days are drawn broken, so a month away never reads as a line.
 */
import type { LocalDate } from '../types/calendar.js';
import type {
  JumpTest,
  ProjectionResult,
  TrendPoint,
  TrendResult,
} from '../types/analytics.js';
import { diffDays } from '../calendar.js';
import { mmToIn } from '../units.js';
import { sessionBestMm } from './sessionBest.js';
import { fittedAt } from './theilSen.js';

/** The fixed horizontal frame: program start to target date. */
export interface XDomain {
  start: LocalDate;
  end: LocalDate;
  /** Weeks from program start to the target date. */
  weeks: number;
  /** Days from program start to the target date. */
  days: number;
}

/** The fixed vertical frame, in whole inches. */
export interface YDomain {
  minIn: number;
  maxIn: number;
}

/** One drawable point: weeks since program start against inches. */
export interface ChartPoint {
  weeks: number;
  valueIn: number;
  date: LocalDate;
}

/** A contiguous run of points with no gap longer than the break. */
export interface ChartSegment {
  points: ChartPoint[];
  /** Days between this segment and the previous one; 0 for the first. */
  gapDays: number;
}

/** The dashed projection line and the band that rides with it. */
export interface ProjectionLine {
  /** Two points: the fit on the last test's date, and the target date. */
  points: ChartPoint[];
  /** The band edges at the target date, in inches. */
  lowIn: number;
  highIn: number;
  atTargetIn: number;
  n: number;
}

/** Turn canonical tests into fit points: weeks since start against inches. */
export function trendPoints(tests: JumpTest[], programStart: LocalDate): TrendPoint[] {
  const points: TrendPoint[] = [];
  for (const test of tests) {
    const best = sessionBestMm(test);
    if (best === null) continue;
    points.push({
      weeks: diffDays(programStart, test.date) / 7,
      valueIn: mmToIn(best),
      date: test.date,
    });
  }
  return points;
}

/** The fixed horizontal frame. */
export function xDomain(programStart: LocalDate, targetDate: LocalDate): XDomain {
  const days = diffDays(programStart, targetDate);
  return { start: programStart, end: targetDate, days, weeks: days / 7 };
}

/**
 * The fixed vertical frame in whole inches. Padding is 2 in either side; the
 * low edge floors and the high edge ceils, so the frame always contains the
 * numbers it was built from.
 */
export function yDomain(
  baselineIn: number,
  goalIn: number,
  testValuesIn: readonly number[] = [],
  padIn = 2,
): YDomain {
  const low = Math.min(baselineIn, ...testValuesIn);
  const high = Math.max(goalIn, ...testValuesIn);
  return {
    minIn: Math.floor(low - padIn),
    maxIn: Math.ceil(high + padIn),
  };
}

/**
 * Split a series wherever the calendar gap exceeds `maxGapDays`, so the chart
 * draws broken segments instead of a line across a month with no tests.
 */
export function brokenSegments(
  points: readonly ChartPoint[],
  maxGapDays = 21,
): ChartSegment[] {
  const segments: ChartSegment[] = [];
  let current: ChartPoint[] = [];
  let gapDays = 0;

  for (const point of points) {
    const previous = current[current.length - 1];
    if (previous === undefined) {
      current.push(point);
      continue;
    }
    const gap = diffDays(previous.date, point.date);
    if (gap > maxGapDays) {
      segments.push({ points: current, gapDays });
      gapDays = gap;
      current = [point];
      continue;
    }
    current.push(point);
  }
  if (current.length > 0) segments.push({ points: current, gapDays });
  return segments;
}

/** The solid trend segment drawn over the observed range only. */
export function trendLine(points: readonly TrendPoint[], trend: TrendResult): ChartPoint[] {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return [];
  return [
    { weeks: first.weeks, valueIn: fittedAt(trend, first.weeks), date: first.date },
    { weeks: last.weeks, valueIn: fittedAt(trend, last.weeks), date: last.date },
  ];
}

/**
 * The dashed projection: from the fit on the last test's date to the target
 * date, with the band the trend range implies. Hidden when the goal is met,
 * which the caller decides from the pace state.
 */
export function projectionLine(
  points: readonly TrendPoint[],
  trend: TrendResult,
  result: ProjectionResult,
  programStart: LocalDate,
): ProjectionLine {
  const last = points[points.length - 1];
  if (last === undefined) throw new RangeError('projectionLine needs at least one point');
  const targetWeeks = diffDays(programStart, result.targetDate) / 7;
  return {
    points: [
      { weeks: last.weeks, valueIn: fittedAt(trend, last.weeks), date: last.date },
      { weeks: targetWeeks, valueIn: result.atTargetIn, date: result.targetDate },
    ],
    lowIn: result.lowIn,
    highIn: result.highIn,
    atTargetIn: result.atTargetIn,
    n: result.n,
  };
}

/** The thin grey required-pace line from the baseline to the goal point. */
export function requiredPaceLine(
  baselineIn: number,
  requiredInPerWk: number,
  domain: XDomain,
): ChartPoint[] {
  return [
    { weeks: 0, valueIn: baselineIn, date: domain.start },
    {
      weeks: domain.weeks,
      valueIn: baselineIn + requiredInPerWk * domain.weeks,
      date: domain.end,
    },
  ];
}
