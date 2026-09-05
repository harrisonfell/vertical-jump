/**
 * Earning autoregulation (brief section 11 "Shadow autoregulation and the
 * gate"). Whoop-driven adjustment stays in shadow mode until the owner's own
 * data justifies it. Every criterion is shown with its live count, so the gate
 * is a fact rather than a promise.
 *
 * All of these are required:
 *   28 or more scored, non-calibrating days
 *   20 or more paired days over 6 or more weeks
 *   6 or more canonical tests
 *   and a relationship: either Spearman rho of at least 0.3 between same-day
 *   recovery and test height or residual RPE with n of 20 or more, or shadow
 *   Red days averaging at least 1 in lower test height than Green days with
 *   3 or more tests in each band.
 *
 * The two copy states for the last criterion are quoted verbatim:
 *   "Not enough tests to check (12 of 20)"
 *   "Checked: no relationship (rho 0.1, n 24)"
 *
 * Counters are keyed to the athlete, not the program.
 */
import { at, formatInValue } from './format.js';
import { roundHalfUp } from '../units.js';

/** The gate's thresholds, all of them from brief section 11. */
export interface GateThresholds {
  scoredDays: number;
  pairedDays: number;
  pairedWeeks: number;
  canonicalTests: number;
  rhoMin: number;
  rhoMinN: number;
  bandGapIn: number;
  bandMinTests: number;
}

/** The defaults the app ships with. */
export const GATE_THRESHOLDS: GateThresholds = {
  scoredDays: 28,
  pairedDays: 20,
  pairedWeeks: 6,
  canonicalTests: 6,
  rhoMin: 0.3,
  rhoMinN: 20,
  bandGapIn: 1,
  bandMinTests: 3,
};

/** One same-day pair: that morning's recovery against the day's output. */
export interface RecoveryOutputPair {
  recovery: number;
  /** Test height in inches, or residual RPE. Either feeds the same rho. */
  output: number;
}

/** Everything the gate counts, all of it keyed to the athlete. */
export interface GateInput {
  /** Days with a scored Whoop recovery, calibration sessions excluded. */
  scoredNonCalibratingDays: number;
  /** Days with both a recovery score and a logged session. */
  pairedDays: number;
  /** Calendar weeks the paired days span. */
  pairedWeeks: number;
  canonicalTests: number;
  /** Same-day pairs for the Spearman check. */
  pairs: readonly RecoveryOutputPair[];
  /** Canonical test heights in inches on shadow Red days. */
  redBandTestsIn: readonly number[];
  /** Canonical test heights in inches on shadow Green days. */
  greenBandTestsIn: readonly number[];
  thresholds?: GateThresholds;
}

/** One criterion, with the live count the Settings row shows. */
export interface GateCriterion {
  id: 'scored_days' | 'paired_days' | 'paired_weeks' | 'canonical_tests' | 'relationship';
  met: boolean;
  count: number;
  needed: number;
  /** "28 scored days (24 of 28)" and its kin. */
  line: string;
}

/** How the relationship criterion resolved. */
export interface GateRelationship {
  state: 'not_enough' | 'checked_none' | 'checked_related' | 'bands_related';
  rho: number | null;
  n: number;
  /** The verbatim copy from brief section 11. */
  line: string;
}

/** The gate, ready for the Settings list. */
export interface GateResult {
  eligible: boolean;
  criteria: GateCriterion[];
  relationship: GateRelationship;
  thresholds: GateThresholds;
}

/** Average ranks, ties shared, so a flat stretch cannot invent an order. */
function rank(values: readonly number[]): number[] {
  const order = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => (a.value === b.value ? a.index - b.index : a.value - b.value));
  const ranks = new Array<number>(values.length).fill(0);
  let i = 0;
  while (i < order.length) {
    let j = i;
    const head = order[i];
    if (head === undefined) break;
    while (j + 1 < order.length) {
      const next = order[j + 1];
      if (next === undefined || next.value !== head.value) break;
      j += 1;
    }
    const shared = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) {
      const entry = order[k];
      if (entry !== undefined) ranks[entry.index] = shared;
    }
    i = j + 1;
  }
  return ranks;
}

/**
 * Spearman rank correlation, ties handled by average ranks (so it is Pearson
 * on the ranks, not the shortcut formula). Null when fewer than two pairs or
 * when either side has no spread.
 */
export function spearmanRho(pairs: readonly RecoveryOutputPair[]): number | null {
  const n = pairs.length;
  if (n < 2) return null;
  const xs = rank(pairs.map((pair) => pair.recovery));
  const ys = rank(pairs.map((pair) => pair.output));
  const meanX = xs.reduce((sum, value) => sum + value, 0) / n;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = at(xs, i) - meanX;
    const dy = at(ys, i) - meanY;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Evaluate the gate. Every criterion carries its live count. */
export function evaluateAutoregulationGate(input: GateInput): GateResult {
  const thresholds = input.thresholds ?? GATE_THRESHOLDS;
  const relationship = evaluateRelationship(input, thresholds);

  const criteria: GateCriterion[] = [
    criterion(
      'scored_days',
      input.scoredNonCalibratingDays,
      thresholds.scoredDays,
      'scored days',
    ),
    criterion('paired_days', input.pairedDays, thresholds.pairedDays, 'paired days'),
    criterion('paired_weeks', input.pairedWeeks, thresholds.pairedWeeks, 'weeks of pairs'),
    criterion(
      'canonical_tests',
      input.canonicalTests,
      thresholds.canonicalTests,
      'canonical tests',
    ),
    {
      id: 'relationship',
      met: relationship.state === 'checked_related' || relationship.state === 'bands_related',
      count: relationship.n,
      needed: thresholds.rhoMinN,
      line: relationship.line,
    },
  ];

  return {
    eligible: criteria.every((entry) => entry.met),
    criteria,
    relationship,
    thresholds,
  };
}

function criterion(
  id: GateCriterion['id'],
  count: number,
  needed: number,
  noun: string,
): GateCriterion {
  return {
    id,
    met: count >= needed,
    count,
    needed,
    line: `${needed} ${noun} (${count} of ${needed})`,
  };
}

function evaluateRelationship(
  input: GateInput,
  thresholds: GateThresholds,
): GateRelationship {
  const n = input.pairs.length;
  const redMean = mean(input.redBandTestsIn);
  const greenMean = mean(input.greenBandTestsIn);
  const bandsUsable =
    redMean !== null &&
    greenMean !== null &&
    input.redBandTestsIn.length >= thresholds.bandMinTests &&
    input.greenBandTestsIn.length >= thresholds.bandMinTests;
  const bandGap = bandsUsable && greenMean !== null && redMean !== null ? greenMean - redMean : null;

  if (bandGap !== null && bandGap >= thresholds.bandGapIn) {
    return {
      state: 'bands_related',
      rho: null,
      n,
      line: `Checked: Red days test ${formatInValue(bandGap)} in lower than Green (${input.redBandTestsIn.length} Red tests, ${input.greenBandTestsIn.length} Green).`,
    };
  }

  if (n < thresholds.rhoMinN) {
    return {
      state: 'not_enough',
      rho: null,
      n,
      line: `Not enough tests to check (${n} of ${thresholds.rhoMinN})`,
    };
  }

  const rho = spearmanRho(input.pairs);
  if (rho === null) {
    return {
      state: 'not_enough',
      rho: null,
      n,
      line: `Not enough tests to check (${n} of ${thresholds.rhoMinN})`,
    };
  }

  if (rho >= thresholds.rhoMin) {
    return {
      state: 'checked_related',
      rho,
      n,
      line: `Checked: recovery tracks output (rho ${formatRho(rho)}, n ${n})`,
    };
  }

  return {
    state: 'checked_none',
    rho,
    n,
    line: `Checked: no relationship (rho ${formatRho(rho)}, n ${n})`,
  };
}

/** One decimal, unsigned zero, matching the brief's "rho 0.1". */
function formatRho(rho: number): string {
  return formatInValue(roundHalfUp(rho, 1));
}
