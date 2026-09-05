/**
 * The readiness gate: the two channels, the five states, and the exact line
 * each one shows (house rule `house.sc.readiness_gate`).
 *
 * The channels are never averaged, so every case here fixes one channel and
 * moves the other. The lines are asserted verbatim, because the line is the
 * product: an adjustment the athlete cannot read is an adjustment they cannot
 * undo by changing the answer.
 */
import { describe, expect, it } from 'vitest';

import { RULESET_V1 } from '../src/ruleset/index.js';
import {
  MIN_BASELINE_TESTS,
  READINESS_HOUSE_RULE_ID,
  combineBands,
  rollingMedian,
  scoreReadiness,
} from '../src/readiness/index.js';
import type {
  ReadinessTestConfig,
  ReadinessTestSession,
  ReadinessWhoopInput,
} from '../src/types/readiness.js';

const CONFIG: ReadinessTestConfig = RULESET_V1.constants.climbing.readiness;

/** Seven prior throws whose median is 7.1 m, the spec example's baseline. */
const BASELINE = [6.9, 7.0, 7.0, 7.1, 7.2, 7.3, 7.4];

function history(values: readonly number[] = BASELINE): ReadinessTestSession[] {
  return values.map((best, index) => ({
    id: `t${index}`,
    date: `2026-09-${String(index + 1).padStart(2, '0')}`,
    kind: 'seated_mb_throw',
    attempts: [best - 0.2, best - 0.1, best],
    best,
    unit: 'm',
  }));
}

function todaysThrow(best: number): ReadinessTestSession {
  return {
    id: 'today',
    date: '2026-09-20',
    kind: 'seated_mb_throw',
    attempts: [best - 0.3, best - 0.1, best],
    best,
    unit: 'm',
  };
}

function whoop(score: number | null, band: 'low' | 'moderate' | 'high' | null): ReadinessWhoopInput {
  return { date: '2026-09-20', score, band };
}

describe('the rolling median', () => {
  it('takes the middle reading, and the mean of two when the count is even', () => {
    expect(rollingMedian([7.1, 6.9, 7.4, 7.0, 7.2, 7.0, 7.3])).toBeCloseTo(7.1, 10);
    expect(rollingMedian([7.0, 7.2])).toBeCloseTo(7.1, 10);
    expect(rollingMedian([])).toBeNull();
  });

  it('reads the last window of same-kind tests and ignores the rest', () => {
    const long = history([1, 1, 1, 1, 1, 1, 6.9, 7.0, 7.0, 7.1, 7.2, 7.3, 7.4]);
    const outcome = scoreReadiness(CONFIG, whoop(70, 'high'), todaysThrow(7.0), long, RULESET_V1);
    expect(outcome.channels[1].line).toBe('Throw 7.0 m (7-test median 7.1, within 5%).');
  });
});

describe('the four states', () => {
  it('runs the session as written when both channels are high', () => {
    const outcome = scoreReadiness(CONFIG, whoop(68, 'high'), todaysThrow(7.2), history(), RULESET_V1);
    expect(outcome.state).toBe('both_high');
    expect(outcome.houseRuleId).toBe(READINESS_HOUSE_RULE_ID);
    expect(outcome.line).toBe(
      'Readiness: recovery 68% High, throw 7.2 m (7-test median 7.1, within 5%). ' +
        'Autonomic fine, neuromuscular fine: session as written.',
    );
    expect(outcome.adjustment).toEqual({
      tierDown: false,
      holdVolume: false,
      removeMaximalJumps: false,
      jumpVolumeFactor: 1,
      loadFactor: 1,
      extraReps: 0,
      offerRecoverySwap: false,
    });
  });

  it('holds the volume when the autonomic channel alone is low', () => {
    const outcome = scoreReadiness(CONFIG, whoop(41, 'low'), todaysThrow(6.8), history(), RULESET_V1);
    expect(outcome.state).toBe('autonomic_low');
    expect(outcome.line).toBe(
      'Readiness: recovery 41% Low, throw 6.8 m (7-test median 7.1, within 5%). ' +
        'Autonomic low, neuromuscular fine: session as written, volume held.',
    );
    expect(outcome.adjustment.holdVolume).toBe(true);
    expect(outcome.adjustment.loadFactor).toBe(1);
  });

  it('drops power and maximal work when the neuromuscular channel alone is low', () => {
    const outcome = scoreReadiness(CONFIG, whoop(68, 'high'), todaysThrow(6.4), history(), RULESET_V1);
    expect(outcome.state).toBe('neuromuscular_low');
    expect(outcome.line).toBe(
      'Readiness: recovery 68% High, throw 6.4 m (7-test median 7.1, down 10%). ' +
        'Autonomic fine, neuromuscular low: maximal jumps out, jump volume down 25%, loads held.',
    );
    expect(outcome.adjustment.removeMaximalJumps).toBe(true);
    expect(outcome.adjustment.jumpVolumeFactor).toBe(0.75);
    expect(outcome.adjustment.loadFactor).toBe(1);
  });

  it('takes the R27 magnitude and offers a recovery day when both are low', () => {
    const outcome = scoreReadiness(CONFIG, whoop(32, 'low'), todaysThrow(6.4), history(), RULESET_V1);
    expect(outcome.state).toBe('both_low');
    expect(outcome.line).toBe(
      'Readiness: recovery 32% Low, throw 6.4 m (7-test median 7.1, down 10%). ' +
        'Autonomic low, neuromuscular low: maximal jumps out, jump volume down 50%, ' +
        'loads down 10%, 2 more reps a set. You can move a recovery day here.',
    );
    expect(outcome.adjustment.extraReps).toBe(2);
    expect(outcome.adjustment.offerRecoverySwap).toBe(true);
  });
});

describe('the Whoop band', () => {
  it('counts Moderate as high unless the score itself is under the floor', () => {
    const high = scoreReadiness(CONFIG, whoop(55, 'moderate'), todaysThrow(7.2), history(), RULESET_V1);
    expect(high.channels[0].band).toBe('high');
    expect(high.state).toBe('both_high');

    const low = scoreReadiness(CONFIG, whoop(38, 'moderate'), todaysThrow(7.2), history(), RULESET_V1);
    expect(low.channels[0].band).toBe('low');
    expect(low.state).toBe('autonomic_low');
    expect(low.channels[0].line).toBe('Recovery 38% Moderate. Data by WHOOP');
  });

  it('reads the score at the floor as high and the point below it as low', () => {
    const at = scoreReadiness(CONFIG, whoop(40, 'moderate'), todaysThrow(7.2), history(), RULESET_V1);
    expect(at.channels[0].band).toBe('high');
    const below = scoreReadiness(CONFIG, whoop(39, 'moderate'), todaysThrow(7.2), history(), RULESET_V1);
    expect(below.channels[0].band).toBe('low');
  });
});

describe('the neuromuscular threshold', () => {
  it('reads exactly five percent below the median as within the band', () => {
    const flat = history([6.8, 6.9, 7.0, 7.0, 7.0, 7.1, 7.2]);
    const at = scoreReadiness(CONFIG, whoop(68, 'high'), todaysThrow(6.65), flat, RULESET_V1);
    expect(at.channels[1].band).toBe('high');
    expect(at.state).toBe('both_high');

    const below = scoreReadiness(CONFIG, whoop(68, 'high'), todaysThrow(6.64), flat, RULESET_V1);
    expect(below.channels[1].band).toBe('low');
    expect(below.state).toBe('neuromuscular_low');
  });
});

describe('a missing channel', () => {
  it('calibrates instead of adjusting until three prior tests exist', () => {
    const outcome = scoreReadiness(
      CONFIG,
      whoop(32, 'low'),
      todaysThrow(5.0),
      history([7.0, 7.1]),
      RULESET_V1,
    );
    expect(MIN_BASELINE_TESTS).toBe(3);
    expect(outcome.state).toBe('unknown');
    expect(outcome.channels[1].band).toBe('unknown');
    expect(outcome.line).toBe(
      'Readiness: recovery 32% Low, throw 5.0 m (calibrating, 2 of 3 tests). ' +
        'Autonomic low, neuromuscular unknown: session as written.',
    );
    expect(outcome.adjustment.loadFactor).toBe(1);
    expect(outcome.adjustment.removeMaximalJumps).toBe(false);
  });

  it('makes no adjustment when no output test was logged, whatever recovery said', () => {
    const outcome = scoreReadiness(CONFIG, whoop(24, 'low'), null, history(), RULESET_V1);
    expect(outcome.state).toBe('unknown');
    expect(outcome.line).toBe(
      'Readiness: recovery 24% Low, no throw logged today. ' +
        'Autonomic low, neuromuscular unknown: session as written.',
    );
  });

  it('adjusts on the neuromuscular channel alone when recovery is missing', () => {
    const outcome = scoreReadiness(CONFIG, null, todaysThrow(6.4), history(), RULESET_V1);
    expect(outcome.state).toBe('neuromuscular_low');
    expect(outcome.channels[0].band).toBe('unknown');
    expect(outcome.channels[0].line).toBe('No recovery score for today.');
    expect(outcome.line).toBe(
      'Readiness: no recovery score, throw 6.4 m (7-test median 7.1, down 10%). ' +
        'Autonomic unknown, neuromuscular low: maximal jumps out, jump volume down 25%, loads held.',
    );
  });

  it('treats an unscored day as unknown, not as a low one', () => {
    const outcome = scoreReadiness(CONFIG, whoop(null, null), todaysThrow(7.2), history(), RULESET_V1);
    expect(outcome.channels[0].band).toBe('unknown');
    expect(outcome.state).toBe('unknown');
  });

  it('says nothing at all when neither channel has data', () => {
    const outcome = scoreReadiness(CONFIG, null, null, [], RULESET_V1);
    expect(outcome.state).toBe('unknown');
    expect(outcome.channels[0].band).toBe('unknown');
    expect(outcome.channels[1].band).toBe('unknown');
    expect(outcome.line).toBe(
      'Readiness: no recovery score, no throw logged today. ' +
        'Autonomic unknown, neuromuscular unknown: session as written.',
    );
  });
});

describe('combining the two bands', () => {
  it('never averages them', () => {
    expect(combineBands('high', 'high')).toBe('both_high');
    expect(combineBands('low', 'high')).toBe('autonomic_low');
    expect(combineBands('high', 'low')).toBe('neuromuscular_low');
    expect(combineBands('low', 'low')).toBe('both_low');
    expect(combineBands('unknown', 'low')).toBe('neuromuscular_low');
    expect(combineBands('unknown', 'high')).toBe('unknown');
    expect(combineBands('low', 'unknown')).toBe('unknown');
    expect(combineBands('unknown', 'unknown')).toBe('unknown');
  });
});

describe('a swapped test', () => {
  it('scores a CMJ in inches and an RSI as a ratio', () => {
    const cmj: ReadinessTestConfig = { ...CONFIG, kind: 'cmj', metric: 'height_in' };
    const heights: ReadinessTestSession[] = [29.0, 29.4, 29.6, 30.0, 30.2, 30.4, 30.8].map(
      (best, index) => ({
        id: `c${index}`,
        date: `2026-09-${String(index + 1).padStart(2, '0')}`,
        kind: 'cmj',
        attempts: [best],
        best,
        unit: 'in',
      }),
    );
    const today: ReadinessTestSession = {
      id: 'today',
      date: '2026-09-20',
      kind: 'cmj',
      attempts: [27.5],
      best: 27.5,
      unit: 'in',
    };
    const outcome = scoreReadiness(cmj, whoop(70, 'high'), today, heights, RULESET_V1);
    expect(outcome.state).toBe('neuromuscular_low');
    expect(outcome.channels[1].line).toBe('Jump 27.5 in (7-test median 30.0, down 8%).');

    const rsi: ReadinessTestConfig = { ...CONFIG, kind: 'rsi', metric: 'rsi' };
    const ratios: ReadinessTestSession[] = [1.9, 1.95, 2.0, 2.0, 2.05, 2.1, 2.15].map(
      (best, index) => ({
        id: `r${index}`,
        date: `2026-09-${String(index + 1).padStart(2, '0')}`,
        kind: 'rsi',
        attempts: [best],
        best,
        unit: 'RSI',
      }),
    );
    const rsiToday: ReadinessTestSession = {
      id: 'today',
      date: '2026-09-20',
      kind: 'rsi',
      attempts: [1.98],
      best: 1.98,
      unit: 'RSI',
    };
    const rsiOutcome = scoreReadiness(rsi, whoop(70, 'high'), rsiToday, ratios, RULESET_V1);
    expect(rsiOutcome.state).toBe('both_high');
    expect(rsiOutcome.channels[1].line).toBe('RSI 1.98 (7-test median 2.00, within 5%).');
  });

  it('ignores history logged under a different test kind', () => {
    const mixed = [...history(), ...history([1, 1, 1]).map((entry) => ({ ...entry, kind: 'cmj' as const }))];
    const outcome = scoreReadiness(CONFIG, whoop(68, 'high'), todaysThrow(6.8), mixed, RULESET_V1);
    expect(outcome.channels[1].line).toBe('Throw 6.8 m (7-test median 7.1, within 5%).');
  });
});
