/**
 * Theil-Sen, the noise floor, the projection band, and the chart frame.
 */
import { describe, expect, it } from 'vitest';
import type { TrendPoint } from '../src/types/analytics.js';
import {
  brokenSegments,
  median,
  noiseSd,
  projection,
  remainingPaceInPerWk,
  requiredPaceInPerWk,
  residuals,
  sampleSd,
  sessionBestMm,
  sessionBestSdIn,
  theilSen,
  trendPoints,
  withinSessionSpreadIn,
  xDomain,
  yDomain,
} from '../src/analytics/index.js';
import { PROGRAM_START, TARGET_DATE, makeSeries, makeTest } from './analytics.support.js';

function line(slope: number, intercept: number, xs: number[]): TrendPoint[] {
  return xs.map((x) => ({ weeks: x, valueIn: intercept + slope * x, date: PROGRAM_START }));
}

describe('median and sampleSd', () => {
  it('takes the middle value on an odd list and the mean of two on an even one', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(() => median([])).toThrow(RangeError);
  });

  it('returns zero below two values and the sample SD above', () => {
    expect(sampleSd([])).toBe(0);
    expect(sampleSd([5])).toBe(0);
    expect(sampleSd([32.0, 32.7, 33.4])).toBeCloseTo(0.7, 10);
  });
});

describe('theilSen', () => {
  it('recovers a known line exactly when the points sit on it', () => {
    const trend = theilSen(line(0.5, 30, [0, 1, 2, 3, 4, 5]));
    expect(trend.slopeInPerWk).toBeCloseTo(0.5, 12);
    expect(trend.interceptIn).toBeCloseTo(30, 12);
    expect(trend.n).toBe(6);
    expect(trend.method).toBe('theil_sen');
    expect(residuals(line(0.5, 30, [0, 1, 2]), 0.5, 30)).toEqual([0, 0, 0]);
  });

  it('shrugs off one bad-shoes outlier that would drag a least-squares fit', () => {
    const points = line(0.5, 30, [0, 1, 2, 3, 4, 5, 6, 7]);
    const bad = points.map((point, index) =>
      index === 3 ? { ...point, valueIn: point.valueIn - 6 } : point,
    );
    const trend = theilSen(bad);
    expect(trend.slopeInPerWk).toBeCloseTo(0.5, 6);
  });

  it('floors the residual SD at 0.6 in until eight tests exist', () => {
    const four = theilSen(line(0.3, 32, [0, 1, 2, 3]));
    expect(four.residualSdIn).toBe(0.6);
    expect(four.sdFloored).toBe(true);

    const eight = theilSen(line(0.3, 32, [0, 1, 2, 3, 4, 5, 6, 7]));
    expect(eight.residualSdIn).toBeCloseTo(0, 10);
    expect(eight.sdFloored).toBe(false);
  });

  it('reports the range as one standard error either side of the slope', () => {
    const points = line(0.3, 32, [0, 1, 2, 3]);
    const trend = theilSen(points);
    // sd 0.6 floored, sum of (x - xbar)^2 = 5, so SE = 0.6 / sqrt(5).
    const se = 0.6 / Math.sqrt(5);
    expect(trend.high - trend.slopeInPerWk).toBeCloseTo(se, 12);
    expect(trend.slopeInPerWk - trend.low).toBeCloseTo(se, 12);
  });

  it('refuses a fit it cannot make', () => {
    expect(() => theilSen(line(0.3, 32, [1]))).toThrow(RangeError);
    expect(() =>
      theilSen([
        { weeks: 1, valueIn: 32, date: PROGRAM_START },
        { weeks: 1, valueIn: 33, date: PROGRAM_START },
      ]),
    ).toThrow(RangeError);
  });
});

describe('noiseSd', () => {
  it('uses the floor below eight tests and the measured SD at eight', () => {
    expect(noiseSd([0.1, -0.1, 0.05], 3)).toEqual({ sdIn: 0.6, floored: true });
    expect(noiseSd([2, -2, 1.5, -1.5], 4).floored).toBe(false);
    const measured = noiseSd([0.1, -0.1, 0.05, -0.05, 0, 0.02, -0.02, 0.01], 8);
    expect(measured.floored).toBe(false);
    expect(measured.sdIn).toBeLessThan(0.6);
  });

  it('measures the within-session spread from the attempts themselves', () => {
    const test = makeTest('spread', { day: 4, attemptsIn: [32.0, 32.7, 33.4] });
    expect(withinSessionSpreadIn(test)).toBeCloseTo(0.7, 10);
    expect(withinSessionSpreadIn(makeTest('one', { day: 4, attemptsIn: [32] }))).toBeNull();
  });

  it('takes the session best from unflagged attempts only', () => {
    const test = makeTest('flagged', {
      day: 4,
      attemptsIn: [31.0, 40.0, 32.0],
      flagged: [1],
    });
    const best = sessionBestMm(test);
    expect(best).not.toBeNull();
    expect(best ?? 0).toBeCloseTo(32.0 * 25.4, 9);
  });

  it('reports the session-best SD across sessions', () => {
    const tests = makeSeries([0, 7, 14], [32.0, 32.7, 33.4]);
    expect(sessionBestSdIn(tests)).toBeCloseTo(0.7, 10);
    expect(sessionBestSdIn(tests.slice(0, 1))).toBeNull();
  });
});

describe('projection', () => {
  const days = [4, 15, 26, 37, 48, 59];
  const heights = days.map((day) => 34.6 + 0.12 * (day / 7));

  it('stays hidden below six tests', () => {
    const points = trendPoints(makeSeries(days.slice(0, 5), heights.slice(0, 5)), PROGRAM_START);
    const trend = theilSen(points);
    expect(projection(points, trend, TARGET_DATE, PROGRAM_START)).toBeNull();
  });

  it('carries the trend range forward to the target date at six tests', () => {
    const points = trendPoints(makeSeries(days, heights), PROGRAM_START);
    const trend = theilSen(points);
    const result = projection(points, trend, TARGET_DATE, PROGRAM_START);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.n).toBe(6);
    expect(result.targetDate).toBe(TARGET_DATE);
    expect(result.atTargetIn).toBeCloseTo(34.6 + 0.12 * (82 / 7), 8);
    expect(result.lowIn).toBeLessThan(result.atTargetIn);
    expect(result.highIn).toBeGreaterThan(result.atTargetIn);
  });
});

describe('required and remaining pace', () => {
  it('fixes the required pace at program start', () => {
    expect(requiredPaceInPerWk(32.5, 36.0, 12)).toBeCloseTo(0.2917, 4);
  });

  it('reads the remaining pace against the weeks that are left', () => {
    expect(remainingPaceInPerWk(33.5, 36.0, 5)).toBeCloseTo(0.5, 10);
    expect(remainingPaceInPerWk(33.5, 36.0, 0)).toBeCloseTo(2.5, 10);
  });
});

describe('chart frame', () => {
  it('fixes the x domain from program start to target date', () => {
    const domain = xDomain(PROGRAM_START, TARGET_DATE);
    expect(domain.start).toBe(PROGRAM_START);
    expect(domain.end).toBe(TARGET_DATE);
    expect(domain.days).toBe(82);
    expect(domain.weeks).toBeCloseTo(82 / 7, 10);
  });

  it('fixes the y domain and does not rescale as tests arrive inside it', () => {
    const empty = yDomain(29.4, 36.0);
    expect(empty).toEqual({ minIn: 27, maxIn: 38 });
    expect(yDomain(29.4, 36.0, [30.1, 31.5])).toEqual({ minIn: 27, maxIn: 38 });
    expect(yDomain(29.4, 36.0, [30.1, 31.5, 32.0, 33.9])).toEqual({ minIn: 27, maxIn: 38 });
  });

  it('opens out only for a number outside the frame', () => {
    expect(yDomain(29.4, 36.0, [26.0])).toEqual({ minIn: 24, maxIn: 38 });
    expect(yDomain(29.4, 36.0, [37.2])).toEqual({ minIn: 27, maxIn: 40 });
  });

  it('breaks the series wherever the gap runs over 21 days', () => {
    const points = trendPoints(
      makeSeries([0, 7, 14, 45, 52], [30, 30.4, 30.8, 31.5, 31.9]),
      PROGRAM_START,
    );
    const segments = brokenSegments(points);
    expect(segments).toHaveLength(2);
    expect(segments[0]?.points).toHaveLength(3);
    expect(segments[1]?.points).toHaveLength(2);
    expect(segments[1]?.gapDays).toBe(31);
  });

  it('keeps one segment when every gap is 21 days or under', () => {
    const points = trendPoints(makeSeries([0, 21, 42], [30, 30.5, 31]), PROGRAM_START);
    expect(brokenSegments(points)).toHaveLength(1);
  });
});
