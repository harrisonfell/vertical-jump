/**
 * PR thresholds per stream, the calibration window, stream breaks, and the
 * exact result lines from brief section 13 "Key copy".
 */
import { describe, expect, it } from 'vitest';
import { RULESET_V1 } from '../src/ruleset/index.js';
import {
  calibrationSpread,
  classifyTest,
  evaluatePr,
  instrumentLabel,
  prThreshold,
  sessionBestSdIn,
  sinceStreamBreak,
} from '../src/analytics/index.js';
import { buildOwnerFixture } from '../src/fixtures/index.js';
import { inToMm } from '../src/units.js';
import { makeSeries, makeTest } from './analytics.support.js';
import type { JumpTest, PrThresholdResult } from '../src/types/analytics.js';

const DEFAULT_THRESHOLD: PrThresholdResult = {
  instrument: 'ovr_jump_regular',
  thresholdIn: 1.0,
  recalibrated: false,
  spreadIn: null,
  method: 'default',
  sessions: 0,
  reason: 'test',
};

/** Weekly test days, the spacing every one of these streams was logged on. */
const WEEKLY = [0, 7, 14, 21, 28, 35];

/** Five attempts under a session best, spread by an exact inch range. */
function attemptsAround(bestIn: number, rangeIn: number): number[] {
  return [
    bestIn - rangeIn,
    bestIn,
    bestIn - rangeIn / 2,
    bestIn - rangeIn / 4,
    bestIn - rangeIn * 0.75,
  ];
}

/** A run of sessions with five attempts each, so the attempts carry a spread. */
function seriesWithAttempts(
  days: readonly number[],
  bestsIn: readonly number[],
  rangeIn: number,
): JumpTest[] {
  return days.map((day, index) => {
    const best = bestsIn[index];
    if (best === undefined) throw new RangeError(`no best for day ${day}`);
    return makeTest(`w${index + 1}`, { day, attemptsIn: attemptsAround(best, rangeIn) });
  });
}

describe('prThreshold', () => {
  it('is 1.0 in and says it is waiting before three sessions', () => {
    const tests = makeSeries([4, 11], [32.0, 32.7]);
    const result = prThreshold(tests, 'ovr_jump_regular', RULESET_V1);
    expect(result.thresholdIn).toBe(1);
    expect(result.recalibrated).toBe(false);
    expect(result.spreadIn).toBeNull();
    expect(result.method).toBe('default');
    expect(result.sessions).toBe(2);
    // D-24: every branch of the reason now opens with the threshold itself, so
    // Progress renders one shape of sentence. The old copy opened "Default".
    expect(result.reason).toBe(
      'Threshold 1.0 in: the default until 3 sessions on this stream (2 so far).',
    );
  });

  it('never recalibrates on two sessions, however far apart they read', () => {
    const tests = makeSeries([4, 11], [29.0, 33.0]);
    const result = prThreshold(tests, 'ovr_jump_regular', RULESET_V1);
    expect(result.thresholdIn).toBe(1);
    expect(result.method).toBe('default');
    expect(result.spreadIn).toBeNull();
    expect(result.recalibrated).toBe(false);
  });

  it('keeps 1.0 in on a rising stream whose test noise is 0.3 in', () => {
    // D-24: 29.4 to 32.5 over six sessions. The raw SD of these bests is 1.1 in,
    // which measures the climb and used to push the threshold to 2.5 in, so no
    // PR could fire at all. Around the trend the same stream reads 0.3 in.
    const rising = makeSeries(WEEKLY, [29.4, 30.3, 30.3, 31.6, 31.6, 32.5]);
    expect(sessionBestSdIn(rising)).toBeCloseTo(1.14, 2);

    const result = prThreshold(rising, 'ovr_jump_regular', RULESET_V1);
    expect(result.thresholdIn).toBe(1);
    expect(result.recalibrated).toBe(false);
    expect(result.method).toBe('residual');
    expect(result.spreadIn).toBeCloseTo(0.279, 3);
    expect(result.sessions).toBe(6);
    expect(result.reason).toBe(
      'Threshold 1.0 in: your test noise is 0.3 in (spread around your trend over 6 sessions), so the default holds.',
    );
  });

  it('rises to 2.0 in on a flat stream that really is noisy', () => {
    const noisy = makeSeries(WEEKLY, [31.9, 30.1, 31.7, 30.3, 31.5, 30.5]);
    expect(sessionBestSdIn(noisy)).toBeCloseTo(0.79, 2);

    const result = prThreshold(noisy, 'ovr_jump_regular', RULESET_V1);
    expect(result.thresholdIn).toBe(2);
    expect(result.recalibrated).toBe(true);
    expect(result.method).toBe('residual');
    expect(result.spreadIn).toBeCloseTo(0.756, 3);
    expect(result.reason).toBe(
      'Threshold 2.0 in: twice your test noise of 0.8 in (spread around your trend over 6 sessions), rounded up to 0.5 in.',
    );
  });

  it('reads the attempts inside the sessions at three sessions', () => {
    // The bests climb a full inch a week, so their raw SD is 1.0 in and the old
    // rule gave 2.0 in. The attempts say the sitting-to-sitting spread is 0.4.
    const three = seriesWithAttempts([0, 7, 14], [30.0, 31.0, 32.0], 0.4);
    expect(sessionBestSdIn(three)).toBeCloseTo(1.0, 6);

    const result = prThreshold(three, 'ovr_jump_regular', RULESET_V1);
    expect(result.thresholdIn).toBe(1);
    expect(result.method).toBe('within_session');
    expect(result.spreadIn).toBeCloseTo(0.4, 6);
    expect(result.sessions).toBe(3);
    expect(result.reason).toBe(
      'Threshold 1.0 in: your test noise is 0.4 in (spread inside your attempts over 3 sessions), so the default holds.',
    );
  });

  it('raises the threshold from wide attempts at three sessions', () => {
    const three = seriesWithAttempts([0, 7, 14], [30.0, 31.0, 32.0], 0.8);
    const result = prThreshold(three, 'ovr_jump_regular', RULESET_V1);
    expect(result.thresholdIn).toBe(2);
    expect(result.recalibrated).toBe(true);
    expect(result.method).toBe('within_session');
    expect(result.reason).toBe(
      'Threshold 2.0 in: twice your test noise of 0.8 in (spread inside your attempts over 3 sessions), rounded up to 0.5 in.',
    );
  });

  it('falls back to the spread around the average when attempts are missing', () => {
    // Three sessions, one attempt each: nothing to measure inside a session,
    // and three points are too few to fit a trend, so the average carries it.
    // Session bests 32.0, 32.7, 33.4: spread 0.7, twice that 1.4, rounded 1.5.
    const tests = makeSeries([4, 11, 18], [32.0, 32.7, 33.4]);
    const result = prThreshold(tests, 'ovr_jump_regular', RULESET_V1);
    expect(result.spreadIn).toBeCloseTo(0.7, 10);
    expect(result.thresholdIn).toBe(1.5);
    expect(result.recalibrated).toBe(true);
    expect(result.method).toBe('residual');
    expect(result.sessions).toBe(3);
    expect(result.reason).toBe(
      'Threshold 1.5 in: twice your test noise of 0.7 in (spread around your average over 3 sessions), rounded up to 0.5 in.',
    );
  });

  it('keeps the default when twice the spread stays at or under 1.0 in', () => {
    const tests = makeSeries([4, 11, 18, 25], [32.0, 32.2, 32.1, 32.3]);
    const result = prThreshold(tests, 'ovr_jump_regular', RULESET_V1);
    expect(result.thresholdIn).toBe(1);
    expect(result.recalibrated).toBe(false);
    expect(result.reason).toContain(
      'your test noise is 0.1 in (spread around your trend over 4 sessions)',
    );
  });

  it('never reads a spread finer than the device resolution', () => {
    // A stream logged in exact 0.5 in steps leaves no residual at all; the
    // threshold still rests on the OVR Jump's own 0.1 in step.
    const perfect = makeSeries(WEEKLY, [30.0, 30.5, 31.0, 31.5, 32.0, 32.5]);
    const result = prThreshold(perfect, 'ovr_jump_regular', RULESET_V1);
    expect(result.spreadIn).toBe(0.1);
    expect(result.thresholdIn).toBe(1);
    expect(calibrationSpread(perfect)?.floored).toBe(true);
  });

  it('measures only the tests since the newest stream break', () => {
    const tests = [
      ...makeSeries([4, 11, 18], [32.0, 32.7, 33.4], { ovrConnectVersion: '2.0' }),
      ...makeSeries([25, 32], [33.0, 33.2], { ovrConnectVersion: '2.1' }),
    ];
    const result = prThreshold(tests, 'ovr_jump_regular', RULESET_V1);
    expect(result.sessions).toBe(2);
    expect(result.thresholdIn).toBe(1);
  });

  it('ignores another instrument entirely', () => {
    const tests = [
      ...makeSeries([4, 11, 18], [32.0, 32.7, 33.4]),
      makeTest('v', { day: 25, attemptsIn: [40], instrument: 'vertec_reach_touch' }),
    ];
    expect(prThreshold(tests, 'ovr_jump_regular', RULESET_V1).sessions).toBe(3);
    expect(prThreshold(tests, 'vertec_reach_touch', RULESET_V1).sessions).toBe(1);
  });

  it('leaves the owner fixture at the default threshold', () => {
    // D-24 regression guard: the fixture stream rises 29.4 to 32.5 over six
    // sessions. It read 2.5 in from the raw spread of its bests; the spread
    // around its trend is inside the device resolution, so the default holds.
    const fixture = buildOwnerFixture();
    const result = prThreshold(fixture.tests, 'ovr_jump_regular', RULESET_V1);
    expect(result.thresholdIn).toBe(1);
    expect(result.recalibrated).toBe(false);
    expect(result.method).toBe('residual');
    expect(result.spreadIn).toBe(0.1);
    expect(result.sessions).toBe(6);
    expect(result.reason).toBe(
      'Threshold 1.0 in: your test noise is 0.1 in (spread around your trend over 6 sessions), so the default holds.',
    );
  });
});

describe('sinceStreamBreak', () => {
  it('keeps only the run that shares the newest device and app version', () => {
    const tests = [
      ...makeSeries([4, 11, 18], [32.0, 32.2, 32.4], { ovrConnectVersion: '2.0' }),
      ...makeSeries([25, 32], [33.0, 33.2], { ovrConnectVersion: '2.1' }),
    ];
    expect(sinceStreamBreak(tests)).toHaveLength(2);
  });
});

describe('classifyTest', () => {
  const stream = makeSeries([4, 11, 18, 25], [29.5, 30.0, 30.5, 31.3]);

  it('labels the first three sessions on a stream as calibrating', () => {
    const tests = makeSeries([4, 11], [31.0, 31.9]);
    const second = tests[1];
    expect(second).toBeDefined();
    if (second === undefined) return;
    const result = classifyTest(second, tests, DEFAULT_THRESHOLD);
    expect(result.kind).toBe('calibrating');
    expect(result.line).toBe('31.9 in · calibrating (2 of 3)');
    expect(evaluatePr(second, tests, DEFAULT_THRESHOLD)).toBeNull();
  });

  it('never fires a PR during calibration, however big the jump', () => {
    const tests = makeSeries([4, 11, 18], [29.0, 29.5, 36.0]);
    const third = tests[2];
    if (third === undefined) throw new Error('missing test');
    const result = classifyTest(third, tests, DEFAULT_THRESHOLD);
    expect(result.kind).toBe('calibrating');
    expect(result.line).toBe('36.0 in · calibrating (3 of 3)');
    expect(evaluatePr(third, tests, DEFAULT_THRESHOLD)).toBeNull();
  });

  it('never fires a PR across a device-version break', () => {
    const tests = [
      ...makeSeries([4, 11, 18, 25], [29.5, 30.0, 30.5, 31.3], {
        ovrConnectVersion: '2.0',
      }),
      makeTest('new', { day: 32, attemptsIn: [36.0], ovrConnectVersion: '2.1' }),
    ];
    const broken = tests[4];
    if (broken === undefined) throw new Error('missing test');
    const result = classifyTest(broken, tests, DEFAULT_THRESHOLD);
    expect(result.kind).toBe('calibrating');
    expect(result.line).toBe('36.0 in · calibrating (1 of 3)');
    expect(evaluatePr(broken, tests, DEFAULT_THRESHOLD)).toBeNull();
  });

  it('fires the committed PR line at or above the threshold', () => {
    const pr = makeTest('pr', { day: 32, attemptsIn: [32.5] });
    const tests = [...stream, pr];
    const result = classifyTest(pr, tests, DEFAULT_THRESHOLD, {
      baselineMm: inToMm(29.4),
    });
    expect(result.kind).toBe('pr');
    expect(result.line).toBe('32.5 in · OVR Jump · +1.2 vs last · +3.1 vs baseline');
    const row = evaluatePr(pr, tests, DEFAULT_THRESHOLD);
    expect(row?.thresholdUsedIn).toBe(1);
    expect(row?.heightMm).toBeCloseTo(inToMm(32.5), 9);
  });

  it('calls an improvement inside the noise a small PR and still updates it', () => {
    const stream2 = makeSeries([4, 11, 18, 25], [29.5, 30.0, 30.5, 31.7]);
    const small = makeTest('small', { day: 32, attemptsIn: [32.1] });
    const tests = [...stream2, small];
    const result = classifyTest(small, tests, DEFAULT_THRESHOLD);
    expect(result.kind).toBe('small_pr');
    expect(result.line).toBe('32.1 in · +0.4 (within test noise, PR updated)');
    expect(evaluatePr(small, tests, DEFAULT_THRESHOLD)).not.toBeNull();
  });

  it('states a regression in neutral type with the noise sentence', () => {
    const stream3 = makeSeries([4, 11, 18, 25], [29.5, 30.0, 30.5, 32.5]);
    const down = makeTest('down', { day: 32, attemptsIn: [31.0] });
    const tests = [...stream3, down];
    const result = classifyTest(down, tests, DEFAULT_THRESHOLD);
    expect(result.kind).toBe('regression');
    expect(result.line).toBe(
      '31.0 in · −1.5 vs last. Single tests vary about ±1 in; the trend matters.',
    );
    expect(evaluatePr(down, tests, DEFAULT_THRESHOLD)).toBeNull();
  });

  it('says nothing special when the test sits between the last and the PR', () => {
    const stream4 = makeSeries([4, 11, 18, 25], [29.5, 30.0, 33.0, 31.0]);
    const flat = makeTest('flat', { day: 32, attemptsIn: [32.0] });
    const tests = [...stream4, flat];
    const result = classifyTest(flat, tests, DEFAULT_THRESHOLD);
    expect(result.kind).toBe('none');
    expect(result.line).toBe('32.0 in · OVR Jump · +1.0 vs last');
    expect(evaluatePr(flat, tests, DEFAULT_THRESHOLD)).toBeNull();
  });

  it('uses the raised threshold when the owner is a noisy tester', () => {
    const noisy = makeSeries([4, 11, 18, 25], [30.0, 31.4, 30.2, 31.6]);
    const next = makeTest('next', { day: 32, attemptsIn: [32.4] });
    const tests = [...noisy, next];
    const threshold = prThreshold(tests, 'ovr_jump_regular', RULESET_V1);
    expect(threshold.recalibrated).toBe(true);
    const result = classifyTest(next, tests, threshold);
    expect(result.vsPrIn).toBeCloseTo(0.8, 2);
    expect(result.kind).toBe('small_pr');
  });
  it('reads the owner fixture last test against the 1.0 in default', () => {
    // FIXTURE GAP, reported to the orchestrator: the brief wants this test to
    // fire the committed green surface. It cannot, and the threshold is not
    // the reason. The fixture's week-5 test is 31.7 in and its week-6 test
    // 32.5 in, a gain of 0.8 in, under the 1.0 in default that no calibration
    // can go below. One fixture edit (week 5 at 31.4 in) makes it a PR.
    const fixture = buildOwnerFixture();
    const threshold = prThreshold(fixture.tests, 'ovr_jump_regular', RULESET_V1);
    const last = fixture.tests[fixture.tests.length - 1];
    if (last === undefined) throw new Error('the fixture has no tests');

    const result = classifyTest(last, fixture.tests, threshold);
    expect(threshold.thresholdIn).toBe(1);
    expect(result.vsPrIn).toBeCloseTo(0.8, 2);
    expect(result.kind).toBe('small_pr');
    expect(evaluatePr(last, fixture.tests, threshold)).not.toBeNull();
  });
});

describe('instrumentLabel', () => {
  it('names every stream in the words section 13 uses', () => {
    expect(instrumentLabel('ovr_jump_regular')).toBe('OVR Jump');
    expect(instrumentLabel('ovr_jump_rsi')).toBe('OVR Jump RSI');
    expect(instrumentLabel('vertec_reach_touch')).toBe('Vertec');
    expect(instrumentLabel('manual')).toBe('Manual');
  });
});
