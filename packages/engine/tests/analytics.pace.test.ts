/**
 * The five pace states, the target-passed reading, and their exact copy.
 * Every string here is quoted from brief sections 06, 08 and 13; the fixtures
 * are built backwards from the numbers those sentences carry.
 */
import { describe, expect, it } from 'vitest';
import { RULESET_V1 } from '../src/ruleset/index.js';
import { isPlateau, paceReadout, paceState } from '../src/analytics/index.js';
import { inToMm } from '../src/units.js';
import type { PaceInput } from '../src/analytics/index.js';
import { PROGRAM_START, TARGET_DATE, makeSeries, makeTest } from './analytics.support.js';
import type { JumpTest } from '../src/types/analytics.js';

const BASELINE_IN = 32.5;
const GOAL_IN = 36.0;

function input(tests: JumpTest[], overrides: Partial<PaceInput> = {}): PaceInput {
  return {
    tests,
    baselineMm: inToMm(BASELINE_IN),
    goalMm: inToMm(GOAL_IN),
    programStart: PROGRAM_START,
    targetDate: TARGET_DATE,
    today: '2026-10-20',
    ruleset: RULESET_V1,
    ...overrides,
  };
}

describe('paceState needs_tests', () => {
  it('names the tests it still needs', () => {
    const state = paceState(input(makeSeries([4, 11], [32.6, 32.9])));
    expect(state.kind).toBe('needs_tests');
    expect(state.line).toBe('Trend needs 4 tests (2 logged)');
  });

  it('counts no tests at all', () => {
    const state = paceState(input([]));
    expect(state.line).toBe('Trend needs 4 tests (0 logged)');
  });

  it('ignores a baseline test, a non-canonical test, and an all-flagged one', () => {
    const tests = [
      makeTest('b', { day: 0, attemptsIn: [32.5], isBaseline: true }),
      makeTest('n', { day: 4, attemptsIn: [32.6], canonical: false }),
      makeTest('f', { day: 11, attemptsIn: [32.9], flagged: [0] }),
      makeTest('c', { day: 18, attemptsIn: [33.0] }),
    ];
    expect(paceState(input(tests)).line).toBe('Trend needs 4 tests (1 logged)');
  });
});

describe('paceState too_early', () => {
  // Four tests, the last one deferred to the next session two days late, so
  // the x spread gives SE = 0.6 / sqrt(5.44) and the range brief 08 quotes.
  const tests = makeSeries([4, 11, 18, 26], [32.5, 32.8, 33.1, 33.5]);

  it('states the trend with its range and refuses to call it', () => {
    const state = paceState(input(tests));
    expect(state.kind).toBe('too_early');
    expect(state.line).toBe(
      'Trend +0.31 in/wk (range ±1 SE: +0.05 to +0.57) vs required +0.29. Too early to call.',
    );
  });

  it('carries the required pace beside the trend', () => {
    const readout = paceReadout(input(tests));
    expect(readout.requiredInPerWk).toBeCloseTo(0.2917, 4);
    expect(readout.programWeeks).toBe(12);
    expect(readout.projection).toBeNull();
  });
});

describe('paceState tracking', () => {
  // Six tests eleven days apart on the line 34.6 + 0.12 x, which puts the
  // trend range at +0.03 to +0.21 and the band at 35 to 37 in by 29 Nov.
  const days = [4, 15, 26, 37, 48, 59];
  const tests = makeSeries(
    days,
    days.map((day) => 34.6 + 0.12 * (day / 7)),
  );

  it('says behind pace with the projection band', () => {
    const state = paceState(input(tests));
    expect(state.kind).toBe('tracking');
    expect(state.line).toBe(
      'Trend +0.12 in/wk (range +0.03 to +0.21) vs required +0.29. ' +
        'Behind pace: 35 to 37 in by 29 Nov (goal 36).',
    );
  });

  it('says on pace when the range straddles the required pace', () => {
    const state = paceState(input(tests, { baselineMm: inToMm(35.0) }));
    expect(state.kind).toBe('tracking');
    expect(state.line).toBe(
      'Trend +0.12 in/wk (range +0.03 to +0.21) vs required +0.08. ' +
        'On pace: 35 to 37 in by 29 Nov (goal 36).',
    );
  });

  it('says ahead of pace when the whole range clears the required pace', () => {
    const state = paceState(input(tests, { baselineMm: inToMm(35.8) }));
    expect(state.kind).toBe('tracking');
    expect(state.line).toBe(
      'Trend +0.12 in/wk (range +0.03 to +0.21) vs required +0.02. ' +
        'Ahead of pace: 35 to 37 in by 29 Nov (goal 36).',
    );
  });

  it('exposes the verdict and the projection to the chart', () => {
    const readout = paceReadout(input(tests));
    expect(readout.projection).not.toBeNull();
    expect(readout.projection?.n).toBe(6);
    if (readout.state.kind !== 'tracking') throw new Error('expected tracking');
    expect(readout.state.verdict).toBe('behind');
  });
});

describe('paceState goal_met', () => {
  const tests = makeSeries([4, 11, 18, 25], [34.0, 35.0, 36.2, 36.5]);

  it('reports the latest against the goal and how many cleared it', () => {
    const state = paceState(input(tests));
    expect(state.kind).toBe('goal_met');
    expect(state.line).toBe(
      'Goal met · latest 36.5 vs goal 36.0 · 2 tests at or above.',
    );
  });

  it('wins over the target date having passed, so the projection can hide', () => {
    const state = paceReadout(input(tests, { today: '2026-12-06' })).state;
    expect(state.kind).toBe('goal_met');
  });
});

describe('paceState plateau', () => {
  const tests = makeSeries([4, 11, 18, 25, 32], [33.0, 33.1, 32.95, 33.05, 33.12]);

  it('names the band, the trend, and what the next block does', () => {
    const state = paceState(input(tests));
    expect(state.kind).toBe('plateau');
    expect(state.line).toBe(
      'Plateau: 5 tests within ±0.5 in (trend +0.02 in/wk). ' +
        'Next block varies exercise selection.',
    );
  });

  it('is available to the generator without reading a sentence', () => {
    expect(isPlateau(tests, RULESET_V1)).toBe(true);
    expect(isPlateau(tests.slice(0, 4), RULESET_V1)).toBe(false);
  });

  it('does not call real progress a plateau even inside a 1 in window', () => {
    const rising = makeSeries([4, 15, 26, 37, 48], [34.7, 34.86, 35.05, 35.23, 35.42]);
    expect(isPlateau(rising, RULESET_V1)).toBe(false);
  });

  it('does not fire when the five tests spread wider than the band', () => {
    const spread = makeSeries([4, 11, 18, 25, 32], [33.0, 33.1, 32.0, 33.05, 33.12]);
    expect(isPlateau(spread, RULESET_V1)).toBe(false);
  });
});

describe('paceReadout target passed', () => {
  const tests = makeSeries([4, 11, 18, 25], [32.6, 32.9, 33.2, 33.5]);

  it('states the date and the last test against the goal', () => {
    const state = paceReadout(input(tests, { today: '2026-12-06' })).state;
    expect(state.kind).toBe('target_passed');
    expect(state.line).toBe('Target date passed (29 Nov). Last test 33.5 in vs goal 36.0.');
  });

  it('is not reachable through paceState, which keeps the five states', () => {
    const state = paceState(input(tests, { today: '2026-12-06' }));
    expect(state.kind).not.toBe('target_passed');
  });
});
