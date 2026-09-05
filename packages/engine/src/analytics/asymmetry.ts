/**
 * Single-leg asymmetry (house rule `house.sc.asymmetry_tracking`).
 *
 * Peak-force asymmetry is the second strongest correlate with wall time in the
 * owner's spec, so the gap between the legs is tracked and it decides which
 * leg goes first on unilateral work. It is never a canonical test and never a
 * personal record: a single-leg jump belongs to its own mode, not to the jump
 * stream the trend, the pace and the PR threshold are read from.
 */
import type { Side } from '../types/core.js';
import type { LocalDate } from '../types/calendar.js';
import type { SingleLegTest } from '../types/readiness.js';
import { roundHalfUp } from '../units.js';

/**
 * The signed gap between the legs, as a percent of the better leg. Positive
 * means the left leg jumped higher, so the weaker side is the right one.
 *
 * Taken as a share of the better leg rather than of the mean, so "8 percent
 * down on the right" reads as the shortfall of the weaker leg against what the
 * athlete can already do.
 *
 * @returns 0 when both legs are equal, and 0 when either height is not a
 *   positive number, so a missing side never invents a gap.
 */
export function asymmetryPct(leftIn: number, rightIn: number): number {
  if (!Number.isFinite(leftIn) || !Number.isFinite(rightIn)) return 0;
  if (leftIn <= 0 || rightIn <= 0) return 0;
  const better = Math.max(leftIn, rightIn);
  return ((leftIn - rightIn) / better) * 100;
}

/**
 * Which leg goes first (house rule `house.sc.weaker_side_first`): the weaker
 * side from the latest single-leg test, or the athlete's own answer when no
 * test exists yet.
 *
 * @param tests every single-leg test, any order; the latest by date wins, and
 *   ties inside one date fall to the last entry so a retest supersedes.
 * @param answer what the athlete said in setup, when they said anything.
 * @param bandPct a signed gap inside this many percent reads as level, so the
 *   ordering never turns on noise. Pass
 *   `constants.climbing.asymmetryBandPct`.
 * @returns the weaker side, or null when nothing decides it.
 */
export function weakerSideFrom(
  tests: readonly SingleLegTest[],
  answer: Side | null | undefined,
  bandPct: number,
): Side | null {
  let latest: SingleLegTest | undefined;
  for (const test of tests) {
    if (latest === undefined || test.date >= latest.date) latest = test;
  }
  if (latest !== undefined) {
    if (Math.abs(latest.asymmetryPct) <= bandPct) return answer ?? null;
    return latest.asymmetryPct > 0 ? 'right' : 'left';
  }
  return answer ?? null;
}

/** Where a gap sits: level, worth watching, or wide enough to work on. */
export type AsymmetryBand = 'balanced' | 'watch' | 'flag';

/**
 * The band edges, as absolute percent of the better leg. Under 5 percent is
 * level, 5 to 10 is worth watching, over 10 is worth working on. Chosen to
 * sit either side of the owner's spec correlate (peak-force asymmetry against
 * wall time), which gives a direction but no threshold of its own.
 */
export const ASYMMETRY_THRESHOLDS = { watchFromPct: 5, flagFromPct: 10 } as const;

/** One test read into a band, a weaker side, and the words Progress shows. */
export interface AsymmetryReading {
  date: LocalDate;
  leftIn: number;
  rightIn: number;
  /** Signed, positive when the left leg jumped higher. */
  pct: number;
  /** The same gap without its sign, which is what the bands are cut on. */
  gapPct: number;
  band: AsymmetryBand;
  /** Null inside the balanced band: no side is named from noise. */
  weakerSide: Side | null;
  /** Second person, numbers first, no rule number. */
  line: string;
}

/** Which band an absolute gap falls in. */
export function asymmetryBand(
  gapPct: number,
  thresholds: { watchFromPct: number; flagFromPct: number } = ASYMMETRY_THRESHOLDS,
): AsymmetryBand {
  const gap = Math.abs(gapPct);
  if (gap > thresholds.flagFromPct) return 'flag';
  if (gap >= thresholds.watchFromPct) return 'watch';
  return 'balanced';
}

/** One decimal on a height, so 29.35 in never reads as 29 in. */
function inches(value: number): string {
  return `${roundHalfUp(value, 1).toFixed(1)} in`;
}

/**
 * Read one single-leg test: the signed gap, its band, the weaker side, and the
 * line Progress shows. The gap is recomputed from the two heights whenever
 * both are usable, so a stale stored percent never drives the ordering.
 */
export function readAsymmetry(
  test: SingleLegTest,
  thresholds: { watchFromPct: number; flagFromPct: number } = ASYMMETRY_THRESHOLDS,
): AsymmetryReading {
  const computed = asymmetryPct(test.leftIn, test.rightIn);
  const pct = computed === 0 && test.leftIn !== test.rightIn ? test.asymmetryPct : computed;
  const gapPct = Math.abs(pct);
  const band = asymmetryBand(gapPct, thresholds);
  const weakerSide: Side | null = band === 'balanced' ? null : pct > 0 ? 'right' : 'left';
  const heights = `Left ${inches(test.leftIn)}, right ${inches(test.rightIn)}.`;
  const gap = `${roundHalfUp(gapPct, 0).toFixed(0)}%`;
  let line: string;
  if (band === 'balanced') line = `${heights} ${gap} apart, inside the band.`;
  else if (band === 'watch') line = `${heights} ${gap} down on the ${weakerSide}. Worth watching.`;
  else line = `${heights} ${gap} down on the ${weakerSide}. Wide enough to work on.`;
  return { date: test.date, leftIn: test.leftIn, rightIn: test.rightIn, pct, gapPct, band, weakerSide, line };
}

/** Which way the gap has moved across the tests that exist. */
export type AsymmetryDirection = 'narrowing' | 'widening' | 'holding';

/** The Progress section's asymmetry trend, once two tests exist. */
export interface AsymmetryTrend {
  tests: number;
  /** Oldest first, absolute gap per test. */
  points: { date: LocalDate; gapPct: number }[];
  firstGapPct: number;
  latestGapPct: number;
  /** Latest minus first. Negative means the legs have converged. */
  deltaPct: number;
  direction: AsymmetryDirection;
  band: AsymmetryBand;
  line: string;
}

/**
 * The gap over time. Never a trend line: two or three single-leg tests cannot
 * carry Theil-Sen, so this reports the first gap, the latest gap and the
 * direction between them and nothing more.
 *
 * @param tests every single-leg test, any order; sorted here, oldest first.
 * @param flatBandPct a change smaller than this many points reads as holding.
 * @returns null until two tests exist (house rule
 *   `house.sc.asymmetry_tracking`: the section appears at the second test).
 */
export function asymmetryTrend(
  tests: readonly SingleLegTest[],
  flatBandPct = 1,
  thresholds: { watchFromPct: number; flagFromPct: number } = ASYMMETRY_THRESHOLDS,
): AsymmetryTrend | null {
  if (tests.length < 2) return null;
  const sorted = [...tests].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const points = sorted.map((test) => ({
    date: test.date,
    gapPct: readAsymmetry(test, thresholds).gapPct,
  }));
  const first = points[0];
  const latest = points[points.length - 1];
  if (first === undefined || latest === undefined) return null;
  const deltaPct = latest.gapPct - first.gapPct;
  const direction: AsymmetryDirection =
    Math.abs(deltaPct) < flatBandPct ? 'holding' : deltaPct < 0 ? 'narrowing' : 'widening';
  const word = direction === 'holding' ? 'Holding' : direction === 'narrowing' ? 'Narrowing' : 'Widening';
  const firstGap = `${roundHalfUp(first.gapPct, 0).toFixed(0)}%`;
  const latestGap = `${roundHalfUp(latest.gapPct, 0).toFixed(0)}%`;
  return {
    tests: points.length,
    points,
    firstGapPct: first.gapPct,
    latestGapPct: latest.gapPct,
    deltaPct,
    direction,
    band: asymmetryBand(latest.gapPct, thresholds),
    line: `Gap ${firstGap} at the first test, ${latestGap} now, across ${points.length} tests. ${word}.`,
  };
}
