/**
 * The weekly review line, the recovery-versus-output table, the
 * autoregulation gate, and jump readiness from RSI-mode reps.
 */
import { describe, expect, it } from 'vitest';
import {
  GATE_THRESHOLDS,
  evaluateAutoregulationGate,
  formatCount,
  formatShortDate,
  jumpReadiness,
  outcomeWord,
  readinessBaseline,
  recoveryBand,
  recoveryOutputRowLine,
  recoveryOutputTable,
  spearmanRho,
  weeklyReviewLine,
} from '../src/analytics/index.js';
import type { RecoverySession, RecoveryTest } from '../src/analytics/index.js';
import { inToMm } from '../src/units.js';
import { makeTest } from './analytics.support.js';

describe('weeklyReviewLine', () => {
  it('builds the line brief section 05 quotes', () => {
    expect(
      weeklyReviewLine({
        weekNumber: 7,
        programWeeks: 12,
        completed: 3,
        scheduled: 3,
        outcome: 'progress',
        testMm: inToMm(32.5),
        trendInPerWk: 0.3,
        requiredInPerWk: 0.29,
        avgRecovery: 61,
        loadSrpe: 1840,
      }),
    ).toBe(
      'Week 7 of 12 · 3/3 (100%) · progressed · test 32.5 in · ' +
        'trend +0.30 in/wk, need +0.29 · avg recovery 61 · load 1,840 sRPE',
    );
  });

  it('drops the parts it has no data for rather than printing zeros', () => {
    expect(
      weeklyReviewLine({
        weekNumber: 1,
        programWeeks: 12,
        completed: 2,
        scheduled: 3,
        outcome: 'repeat',
      }),
    ).toBe('Week 1 of 12 · 2/3 (67%) · repeated');
  });

  it('names every outcome in the past tense', () => {
    expect(outcomeWord('progress')).toBe('progressed');
    expect(outcomeWord('small')).toBe('small step');
    expect(outcomeWord('hold')).toBe('held');
    expect(outcomeWord('repeat')).toBe('repeated');
  });

  it('groups a four-figure load and writes a short date', () => {
    expect(formatCount(1840)).toBe('1,840');
    expect(formatCount(184)).toBe('184');
    expect(formatShortDate('2026-11-29')).toBe('29 Nov');
    expect(formatShortDate('2026-09-08')).toBe('8 Sep');
  });
});

describe('recoveryOutputTable', () => {
  const sessions: RecoverySession[] = [
    { recovery: 20, rpe: 8, legsFeel: 'heavy' },
    { recovery: 30, rpe: 8, legsFeel: 'heavy' },
    { recovery: 50, rpe: 7, legsFeel: 'normal' },
    { recovery: 60, rpe: 6, legsFeel: 'fresh' },
    { recovery: 80, rpe: 6, legsFeel: 'fresh' },
  ];
  const tests: RecoveryTest[] = [
    { recovery: 25, residualIn: -0.4 },
    { recovery: 70, residualIn: 0.3 },
  ];

  it('puts a recovery score in the Whoop band it belongs to', () => {
    expect(recoveryBand(0)).toBe('low');
    expect(recoveryBand(33)).toBe('low');
    expect(recoveryBand(34)).toBe('moderate');
    expect(recoveryBand(66)).toBe('moderate');
    expect(recoveryBand(67)).toBe('high');
  });

  it('stays collapsed to its counter line before six sessions in a band', () => {
    const table = recoveryOutputTable(sessions, tests);
    expect(table.ready).toBe(false);
    expect(table.counterLine).toBe(
      'Recovery vs output: needs 6 sessions in one band (Low 2, Moderate 2, High 1).',
    );
  });

  it('opens once one band has six sessions', () => {
    const many = [
      ...sessions,
      ...Array.from({ length: 5 }, (): RecoverySession => ({
        recovery: 50,
        rpe: 7,
        legsFeel: 'heavy',
      })),
    ];
    const table = recoveryOutputTable(many, tests);
    expect(table.ready).toBe(true);
    expect(table.counterLine).toBeNull();
  });

  it('reports n, median RPE, percent heavy legs, n tests and median residual', () => {
    const table = recoveryOutputTable(sessions, tests);
    const low = table.rows[0];
    expect(low?.label).toBe('Low');
    expect(low?.sessions).toBe(2);
    expect(low?.medianRpe).toBe(8);
    expect(low?.heavyLegsFraction).toBe(1);
    expect(low?.tests).toBe(1);
    expect(low?.medianResidualIn).toBeCloseTo(-0.4, 10);
    if (low === undefined) return;
    expect(recoveryOutputRowLine(low)).toBe(
      'Low: 2 sessions, median RPE 8.0, 100% heavy legs, 1 test, median residual −0.4 in',
    );
  });

  it('says nothing rather than zero for a band with no answers', () => {
    const table = recoveryOutputTable([{ recovery: 90 }], []);
    const high = table.rows[2];
    expect(high?.medianRpe).toBeNull();
    expect(high?.heavyLegsFraction).toBeNull();
    expect(high?.medianResidualIn).toBeNull();
  });
});

describe('autoregulation gate', () => {
  function pairs(count: number, permuted: boolean): { recovery: number; output: number }[] {
    return Array.from({ length: count }, (_unused, index) => ({
      recovery: index,
      output: permuted ? permutation(index, count) : index,
    }));
  }

  // A permutation with a Spearman rho of about 0.13: the first eighteen ranks
  // reversed, then the last six reversed.
  function permutation(index: number, count: number): number {
    if (count !== 24) return index;
    return index < 18 ? 17 - index : 41 - index;
  }

  const base = {
    scoredNonCalibratingDays: 40,
    pairedDays: 24,
    pairedWeeks: 8,
    canonicalTests: 8,
    redBandTestsIn: [] as number[],
    greenBandTestsIn: [] as number[],
  };

  it('says how many pairs it still needs before it can check', () => {
    const result = evaluateAutoregulationGate({ ...base, pairs: pairs(12, false) });
    expect(result.relationship.state).toBe('not_enough');
    expect(result.relationship.line).toBe('Not enough tests to check (12 of 20)');
    expect(result.eligible).toBe(false);
  });

  it('states no relationship with the rho and the n', () => {
    const result = evaluateAutoregulationGate({ ...base, pairs: pairs(24, true) });
    expect(result.relationship.state).toBe('checked_none');
    expect(result.relationship.line).toBe('Checked: no relationship (rho 0.1, n 24)');
    expect(result.eligible).toBe(false);
  });

  it('opens the gate on a strong rank correlation with every count met', () => {
    const result = evaluateAutoregulationGate({ ...base, pairs: pairs(24, false) });
    expect(result.relationship.state).toBe('checked_related');
    expect(result.relationship.rho).toBeCloseTo(1, 10);
    expect(result.eligible).toBe(true);
  });

  it('opens the gate on the band comparison instead', () => {
    const result = evaluateAutoregulationGate({
      ...base,
      pairs: pairs(4, false),
      redBandTestsIn: [30.0, 30.4, 30.2],
      greenBandTestsIn: [31.6, 31.4, 31.5],
    });
    expect(result.relationship.state).toBe('bands_related');
    expect(result.eligible).toBe(true);
  });

  it('reports every criterion with its live count', () => {
    const result = evaluateAutoregulationGate({
      ...base,
      scoredNonCalibratingDays: 24,
      canonicalTests: 4,
      pairs: pairs(12, false),
    });
    const scored = result.criteria.find((entry) => entry.id === 'scored_days');
    expect(scored?.met).toBe(false);
    expect(scored?.line).toBe('28 scored days (24 of 28)');
    const canonical = result.criteria.find((entry) => entry.id === 'canonical_tests');
    expect(canonical?.line).toBe('6 canonical tests (4 of 6)');
    expect(result.thresholds).toEqual(GATE_THRESHOLDS);
  });

  it('handles ties and a flat column without inventing an order', () => {
    expect(spearmanRho([])).toBeNull();
    expect(spearmanRho([{ recovery: 1, output: 1 }, { recovery: 1, output: 2 }])).toBeNull();
    const tied = spearmanRho([
      { recovery: 1, output: 1 },
      { recovery: 1, output: 2 },
      { recovery: 2, output: 3 },
    ]);
    expect(tied).not.toBeNull();
    expect(tied ?? 0).toBeCloseTo(0.8660254, 6);
  });
});

describe('jump readiness', () => {
  const test = makeTest('rsi', {
    day: 18,
    attemptsIn: [26.0, 26.4, 26.2, 25.0],
    gctMs: [200, 210, 190, 300],
    boxHeightIn: 18,
  });

  it('excludes reps over 250 ms as non-reactive and counts them', () => {
    const stats = jumpReadiness(test);
    expect(stats.reactiveReps).toBe(3);
    expect(stats.nonReactiveReps).toBe(1);
    expect(stats.boxHeightIn).toBe(18);
    expect(stats.bestGctMs).toBe(190);
    expect(stats.meanGctMs).toBeCloseTo(200, 10);
  });

  it('computes mean and best RSI in the app, not off the device', () => {
    const stats = jumpReadiness(test);
    const expected = [26.0 / 200, 26.4 / 210, 26.2 / 190].map((value) => value * 25.4);
    const mean = expected.reduce((sum, value) => sum + value, 0) / expected.length;
    expect(stats.meanRsi ?? 0).toBeCloseTo(mean, 9);
    expect(stats.bestRsi ?? 0).toBeCloseTo(Math.max(...expected), 9);
    expect(stats.rsiSd ?? 0).toBeGreaterThan(0);
  });

  it('feeds the ladder from a rolling baseline, never one rep', () => {
    const older = makeTest('rsi0', {
      day: 4,
      attemptsIn: [25.0, 25.2],
      gctMs: [220, 230],
    });
    const middle = makeTest('rsi1', {
      day: 11,
      attemptsIn: [25.5, 25.7],
      gctMs: [215, 225],
    });
    const baseline = readinessBaseline([older, middle, test]);
    expect(baseline.sessions).toBe(3);
    expect(baseline.meanRsi).not.toBeNull();
    expect(baseline.meanGctMs ?? 0).toBeGreaterThan(190);
    expect(readinessBaseline([older, middle, test], 2).sessions).toBe(2);
  });

  it('returns nulls rather than zeros when no rep was reactive', () => {
    const slow = makeTest('slow', { day: 25, attemptsIn: [24.0], gctMs: [400] });
    const stats = jumpReadiness(slow);
    expect(stats.reactiveReps).toBe(0);
    expect(stats.meanRsi).toBeNull();
    expect(stats.bestGctMs).toBeNull();
    expect(readinessBaseline([slow]).sessions).toBe(0);
  });
});
