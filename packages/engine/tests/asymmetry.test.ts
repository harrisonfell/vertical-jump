/**
 * Single-leg asymmetry (house rule `house.sc.asymmetry_tracking`): the signed
 * gap, the three bands and their copy, which leg goes first, and the trend
 * Progress shows once two tests exist.
 */
import { describe, expect, it } from 'vitest';

import { RULESET_V1 } from '../src/ruleset/index.js';
import {
  ASYMMETRY_THRESHOLDS,
  asymmetryBand,
  asymmetryPct,
  asymmetryTrend,
  readAsymmetry,
  weakerSideFrom,
} from '../src/analytics/asymmetry.js';
import type { SingleLegTest } from '../src/types/readiness.js';

const BAND_PCT = RULESET_V1.constants.climbing.asymmetryBandPct;

function test(date: string, leftIn: number, rightIn: number): SingleLegTest {
  const pct = asymmetryPct(leftIn, rightIn);
  return {
    date,
    instrument: 'ovr_jump_regular',
    leftIn,
    rightIn,
    asymmetryPct: pct,
    weakerSide: pct === 0 ? null : pct > 0 ? 'right' : 'left',
  };
}

describe('the signed gap', () => {
  it('is a share of the better leg, positive when the left leg jumped higher', () => {
    expect(asymmetryPct(30, 30)).toBe(0);
    expect(asymmetryPct(30, 27)).toBeCloseTo(10, 10);
    expect(asymmetryPct(27, 30)).toBeCloseTo(-10, 10);
    expect(asymmetryPct(20, 19)).toBeCloseTo(5, 10);
  });

  it('invents no gap from a missing or impossible side', () => {
    expect(asymmetryPct(0, 30)).toBe(0);
    expect(asymmetryPct(30, 0)).toBe(0);
    expect(asymmetryPct(Number.NaN, 30)).toBe(0);
    expect(asymmetryPct(-5, 30)).toBe(0);
  });
});

describe('the three bands', () => {
  it('cuts at 5 and 10 percent, inclusive at the lower edge only', () => {
    expect(ASYMMETRY_THRESHOLDS).toEqual({ watchFromPct: 5, flagFromPct: 10 });
    expect(asymmetryBand(4.9)).toBe('balanced');
    expect(asymmetryBand(5)).toBe('watch');
    expect(asymmetryBand(10)).toBe('watch');
    expect(asymmetryBand(10.1)).toBe('flag');
    expect(asymmetryBand(-12)).toBe('flag');
  });

  it('says what the numbers are before it says what they mean', () => {
    const balanced = readAsymmetry(test('2026-09-01', 30, 29.4));
    expect(balanced.band).toBe('balanced');
    expect(balanced.weakerSide).toBeNull();
    expect(balanced.line).toBe('Left 30.0 in, right 29.4 in. 2% apart, inside the band.');

    const watch = readAsymmetry(test('2026-09-08', 30, 28));
    expect(watch.band).toBe('watch');
    expect(watch.weakerSide).toBe('right');
    expect(watch.line).toBe('Left 30.0 in, right 28.0 in. 7% down on the right. Worth watching.');

    const flag = readAsymmetry(test('2026-09-15', 26, 30));
    expect(flag.band).toBe('flag');
    expect(flag.weakerSide).toBe('left');
    expect(flag.line).toBe(
      'Left 26.0 in, right 30.0 in. 13% down on the left. Wide enough to work on.',
    );
  });

  it('recomputes the gap from the heights rather than trusting a stale one', () => {
    const stale: SingleLegTest = { ...test('2026-09-01', 30, 27), asymmetryPct: 0, weakerSide: null };
    expect(readAsymmetry(stale).pct).toBeCloseTo(10, 10);
    expect(readAsymmetry(stale).weakerSide).toBe('right');
  });
});

describe('which leg goes first', () => {
  it('takes the latest test, and the athlete answer when there is none', () => {
    const early = test('2026-09-01', 30, 27);
    const later = test('2026-10-01', 27, 30);
    expect(weakerSideFrom([early], null, BAND_PCT)).toBe('right');
    expect(weakerSideFrom([early, later], null, BAND_PCT)).toBe('left');
    expect(weakerSideFrom([later, early], null, BAND_PCT)).toBe('left');
    expect(weakerSideFrom([], 'left', BAND_PCT)).toBe('left');
    expect(weakerSideFrom([], null, BAND_PCT)).toBeNull();
  });

  it('falls back to the answer rather than naming a side from noise', () => {
    const level = test('2026-09-01', 30, 29.5);
    expect(Math.abs(level.asymmetryPct)).toBeLessThan(BAND_PCT);
    expect(weakerSideFrom([level], 'left', BAND_PCT)).toBe('left');
    expect(weakerSideFrom([level], null, BAND_PCT)).toBeNull();
  });

  it('lets a retest on the same date supersede the one before it', () => {
    const first = test('2026-09-01', 30, 27);
    const retest = test('2026-09-01', 27, 30);
    expect(weakerSideFrom([first, retest], null, BAND_PCT)).toBe('left');
  });
});

describe('the trend', () => {
  it('waits for a second test', () => {
    expect(asymmetryTrend([])).toBeNull();
    expect(asymmetryTrend([test('2026-09-01', 30, 27)])).toBeNull();
  });

  it('reports the first gap, the latest gap and the direction, oldest first', () => {
    const trend = asymmetryTrend([
      test('2026-10-01', 30, 28.2),
      test('2026-09-01', 30, 27),
      test('2026-09-15', 30, 27.6),
    ]);
    expect(trend).not.toBeNull();
    expect(trend?.tests).toBe(3);
    expect(trend?.points.map((point) => point.date)).toEqual([
      '2026-09-01',
      '2026-09-15',
      '2026-10-01',
    ]);
    expect(trend?.firstGapPct).toBeCloseTo(10, 10);
    expect(trend?.latestGapPct).toBeCloseTo(6, 10);
    expect(trend?.direction).toBe('narrowing');
    expect(trend?.band).toBe('watch');
    expect(trend?.line).toBe('Gap 10% at the first test, 6% now, across 3 tests. Narrowing.');
  });

  it('calls a widening gap widening and a steady one holding', () => {
    const widening = asymmetryTrend([test('2026-09-01', 30, 29), test('2026-10-01', 30, 26)]);
    expect(widening?.direction).toBe('widening');
    expect(widening?.line).toBe('Gap 3% at the first test, 13% now, across 2 tests. Widening.');

    const holding = asymmetryTrend([test('2026-09-01', 30, 27), test('2026-10-01', 30, 27.1)]);
    expect(holding?.direction).toBe('holding');
    expect(holding?.line).toBe('Gap 10% at the first test, 10% now, across 2 tests. Holding.');
  });
});
