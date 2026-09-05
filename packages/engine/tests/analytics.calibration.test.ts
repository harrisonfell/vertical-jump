/**
 * The calibration spread behind the PR threshold: noise, never progress
 * (defect D-24, house rule read.pr_noise_residual).
 */
import { describe, expect, it } from 'vitest';
import {
  DEVICE_RESOLUTION_IN,
  DEVICE_RESOLUTION_MM,
  calibrationSpread,
  meanWithinSessionRangeIn,
  sessionBestPoints,
  sessionBestSdIn,
  withinSessionRangeIn,
} from '../src/analytics/index.js';
import { mmToIn } from '../src/units.js';
import { makeSeries, makeTest } from './analytics.support.js';

const WEEKLY = [0, 7, 14, 21, 28, 35];

describe('device resolution', () => {
  it('is the OVR Jump step in both units', () => {
    expect(mmToIn(DEVICE_RESOLUTION_MM)).toBeCloseTo(DEVICE_RESOLUTION_IN, 12);
  });
});

describe('withinSessionRangeIn', () => {
  it('is the best attempt minus the worst, flagged attempts left out', () => {
    const test = makeTest('a', { day: 0, attemptsIn: [29.6, 30.0, 33.0, 29.8], flagged: [2] });
    expect(withinSessionRangeIn(test)).toBeCloseTo(0.4, 6);
  });

  it('is null when one attempt stands alone', () => {
    expect(withinSessionRangeIn(makeTest('one', { day: 0, attemptsIn: [30.0] }))).toBeNull();
  });

  it('averages only the sessions that have two attempts', () => {
    const tests = [
      makeTest('a', { day: 0, attemptsIn: [29.6, 30.0] }),
      makeTest('b', { day: 7, attemptsIn: [30.2] }),
      makeTest('c', { day: 14, attemptsIn: [31.2, 32.0] }),
    ];
    expect(meanWithinSessionRangeIn(tests)).toBeCloseTo(0.6, 6);
    const solo = makeTest('solo', { day: 0, attemptsIn: [30.0] });
    expect(meanWithinSessionRangeIn([solo])).toBeNull();
  });
});

describe('sessionBestPoints', () => {
  it('counts weeks from the first session on the stream', () => {
    const points = sessionBestPoints(makeSeries([4, 11, 25], [30.0, 30.5, 31.0]));
    expect(points.map((point) => point.weeks)).toEqual([0, 1, 3]);
    expect(points.map((point) => point.valueIn.toFixed(1))).toEqual(['30.0', '30.5', '31.0']);
  });
});

describe('calibrationSpread', () => {
  it('has nothing to say about a single session', () => {
    expect(calibrationSpread(makeSeries([0], [30.0]))).toBeNull();
  });

  it('measures a rising stream around its trend, not around its average', () => {
    const rising = makeSeries(WEEKLY, [29.4, 30.3, 30.3, 31.6, 31.6, 32.5]);
    const spread = calibrationSpread(rising);
    expect(spread?.method).toBe('residual');
    expect(spread?.basis).toBe('trend');
    expect(spread?.spreadIn).toBeCloseTo(0.279, 3);
    // The same stream read four times as noisy before the trend was taken out.
    expect(sessionBestSdIn(rising)).toBeCloseTo(1.14, 2);
  });

  it('reads the attempts at three sessions, where no trend is trustworthy', () => {
    const three = [
      makeTest('a', { day: 0, attemptsIn: [29.6, 30.0, 29.8] }),
      makeTest('b', { day: 7, attemptsIn: [30.6, 31.0, 30.9] }),
      makeTest('c', { day: 14, attemptsIn: [31.6, 32.0, 31.7] }),
    ];
    const spread = calibrationSpread(three);
    expect(spread?.method).toBe('within_session');
    expect(spread?.basis).toBe('attempts');
    expect(spread?.spreadIn).toBeCloseTo(0.4, 6);
  });

  it('falls back to the average when the sessions carry one attempt each', () => {
    const spread = calibrationSpread(makeSeries([0, 7, 14], [32.0, 32.7, 33.4]));
    expect(spread?.method).toBe('residual');
    expect(spread?.basis).toBe('mean');
    expect(spread?.spreadIn).toBeCloseTo(0.7, 10);
  });

  it('falls back when four sessions share one date, since no line can be fitted', () => {
    const sameDay = [0, 0, 0, 0].map((day, index) =>
      makeTest(`s${index}`, { day, attemptsIn: [30.0 + index * 0.1, 30.4 + index * 0.1] }),
    );
    const spread = calibrationSpread(sameDay);
    expect(spread?.method).toBe('within_session');
    expect(spread?.spreadIn).toBeCloseTo(0.4, 6);
  });

  it('never reads finer than the device', () => {
    const perfect = makeSeries(WEEKLY, [30.0, 30.5, 31.0, 31.5, 32.0, 32.5]);
    const spread = calibrationSpread(perfect);
    expect(spread?.spreadIn).toBe(DEVICE_RESOLUTION_IN);
    expect(spread?.floored).toBe(true);
  });
});
