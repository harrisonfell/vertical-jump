/**
 * The five honest pace states and their exact copy (brief section 08 "The
 * three decision numbers"). Never a colored pill, never an adjective without
 * the number behind it.
 *
 *  needs_tests  "Trend needs 4 tests (2 logged)"
 *  too_early    "Trend +0.31 in/wk (range +/-1 SE: +0.05 to +0.57) vs required
 *                +0.29. Too early to call."
 *  tracking     "Trend +0.12 in/wk (range +0.03 to +0.21) vs required +0.29.
 *                Behind pace: 35 to 37 in by 29 Nov (goal 36)."
 *  goal_met     "Goal met - latest 36.5 vs goal 36.0 - 2 tests at or above."
 *  plateau      "Plateau: 5 tests within +/-0.5 in (trend +0.02 in/wk). Next
 *                block varies exercise selection."
 *
 * A sixth reading exists on screen but not in `PaceState`: the target date has
 * passed. `paceReadout` returns it; see INTERFACE_GAP in the report.
 */
import type { LocalDate } from '../types/calendar.js';
import type {
  JumpTest,
  PaceState,
  ProjectionResult,
  TrendPoint,
  TrendResult,
} from '../types/analytics.js';
import type { Ruleset } from '../types/ruleset.js';
import { diffDays, programWeeks } from '../calendar.js';
import { mmToIn } from '../units.js';
import { trendPoints } from './chart.js';
import {
  DOT,
  PLUS_MINUS,
  formatInValue,
  formatRateInPerWk,
  formatRateValue,
  formatShortDate,
  formatWholeIn,
} from './format.js';
import { sessionBestMm } from './sessionBest.js';
import { theilSen } from './theilSen.js';
import {
  projection,
  remainingPaceInPerWk,
  requiredPaceInPerWk,
} from './projection.js';

/** Everything the readout needs, all of it already stream-filtered. */
export interface PaceInput {
  /** Canonical tests on the primary instrument, oldest first. */
  tests: JumpTest[];
  /** Baseline height in millimetres, fixed at program start. */
  baselineMm: number;
  /** Goal height in millimetres. */
  goalMm: number;
  programStart: LocalDate;
  targetDate: LocalDate;
  today: LocalDate;
  ruleset: Ruleset;
}

/**
 * The target date has gone by without the goal (brief section 06 "Goal date
 * passed"). Not a `PaceState` variant, so it rides beside one.
 */
export interface TargetPassedState {
  kind: 'target_passed';
  targetDate: LocalDate;
  latestIn: number | null;
  goalIn: number;
  /** "Target date passed (29 Nov). Last test 33.5 in vs goal 36.0." */
  line: string;
}

/** Everything the pace readout returns, plus the numbers beside it. */
export interface PaceReadout {
  state: PaceState | TargetPassedState;
  requiredInPerWk: number;
  remainingInPerWk: number;
  weeksLeft: number;
  programWeeks: number;
  trend: TrendResult | null;
  projection: ProjectionResult | null;
  points: TrendPoint[];
}

/** Canonical, non-baseline tests with at least one unflagged attempt. */
export function eligibleTests(tests: readonly JumpTest[]): JumpTest[] {
  return tests.filter(
    (test) => test.canonical && !test.isBaseline && sessionBestMm(test) !== null,
  );
}

/** Best unflagged attempt of the newest eligible test, in inches. */
function latestIn(tests: readonly JumpTest[]): number | null {
  const newest = tests[tests.length - 1];
  if (newest === undefined) return null;
  const best = sessionBestMm(newest);
  return best === null ? null : mmToIn(best);
}

/** Pick the state and build its sentence. Pure; the copy lives here. */
export function paceState(input: PaceInput): PaceState {
  const readout = buildReadout(input, false);
  if (readout.state.kind === 'target_passed') {
    throw new Error('unreachable: the target-passed reading is disabled here');
  }
  return readout.state;
}

/**
 * The pace readout including the target-passed reading, which `PaceState`
 * cannot express. Use this on Progress; `paceState` keeps the engine contract.
 */
export function paceReadout(input: PaceInput): PaceReadout {
  return buildReadout(input, true);
}

function buildReadout(input: PaceInput, includeTargetPassed: boolean): PaceReadout {
  const constants = input.ruleset.constants;
  const tests = eligibleTests(input.tests);
  const points = trendPoints(tests, input.programStart);
  const goalIn = mmToIn(input.goalMm);
  const baselineIn = mmToIn(input.baselineMm);

  const totalWeeks = programWeeks(input.programStart, input.targetDate);
  const requiredInPerWk = requiredPaceInPerWk(baselineIn, goalIn, totalWeeks);
  const daysLeft = diffDays(input.today, input.targetDate);
  const weeksLeft = daysLeft / 7;
  const newestIn = latestIn(tests);
  const remainingInPerWk =
    newestIn === null
      ? requiredInPerWk
      : remainingPaceInPerWk(newestIn, goalIn, weeksLeft);

  const trend =
    points.length >= 2
      ? theilSen(points, constants.noise.residualSdFloorIn, constants.noise.testsBeforeUnfloored)
      : null;
  const projected =
    trend === null
      ? null
      : projection(
          points,
          trend,
          input.targetDate,
          input.programStart,
          constants.trend.minTestsForProjection,
        );

  const base = {
    requiredInPerWk,
    remainingInPerWk,
    weeksLeft,
    programWeeks: totalWeeks,
    trend,
    projection: projected,
    points,
  };

  const atOrAbove = tests.filter((test) => {
    const best = sessionBestMm(test);
    return best !== null && mmToIn(best) >= goalIn;
  }).length;

  if (newestIn !== null && newestIn >= goalIn) {
    return {
      ...base,
      state: {
        kind: 'goal_met',
        latestIn: newestIn,
        goalIn,
        testsAtOrAbove: atOrAbove,
        line: `Goal met ${DOT} latest ${formatInValue(newestIn)} vs goal ${formatInValue(goalIn)} ${DOT} ${atOrAbove} tests at or above.`,
      },
    };
  }

  if (includeTargetPassed && daysLeft < 0) {
    return {
      ...base,
      state: {
        kind: 'target_passed',
        targetDate: input.targetDate,
        latestIn: newestIn,
        goalIn,
        line:
          newestIn === null
            ? `Target date passed (${formatShortDate(input.targetDate)}). No test logged vs goal ${formatInValue(goalIn)}.`
            : `Target date passed (${formatShortDate(input.targetDate)}). Last test ${formatInValue(newestIn)} in vs goal ${formatInValue(goalIn)}.`,
      },
    };
  }

  if (trend !== null && isPlateau(tests, input.ruleset)) {
    const bandIn = constants.plateau.bandIn;
    return {
      ...base,
      state: {
        kind: 'plateau',
        tests: constants.plateau.tests,
        bandIn,
        trend,
        line: `Plateau: ${constants.plateau.tests} tests within ${PLUS_MINUS}${formatInValue(bandIn)} in (trend ${formatRateInPerWk(trend.slopeInPerWk)}). Next block varies exercise selection.`,
      },
    };
  }

  const stated = constants.trend.minTestsForStatedTrend;
  if (trend === null || points.length < stated) {
    return {
      ...base,
      state: {
        kind: 'needs_tests',
        logged: points.length,
        needed: stated,
        line: `Trend needs ${stated} tests (${points.length} logged)`,
      },
    };
  }

  if (projected === null) {
    return {
      ...base,
      state: {
        kind: 'too_early',
        trend,
        requiredInPerWk,
        line: `Trend ${formatRateInPerWk(trend.slopeInPerWk)} (range ${PLUS_MINUS}1 SE: ${formatRateValue(trend.low)} to ${formatRateValue(trend.high)}) vs required ${formatRateValue(requiredInPerWk)}. Too early to call.`,
      },
    };
  }

  const verdict = paceVerdict(trend, requiredInPerWk);
  return {
    ...base,
    state: {
      kind: 'tracking',
      trend,
      requiredInPerWk,
      verdict,
      projection: projected,
      line: `Trend ${formatRateInPerWk(trend.slopeInPerWk)} (range ${formatRateValue(trend.low)} to ${formatRateValue(trend.high)}) vs required ${formatRateValue(requiredInPerWk)}. ${verdictWord(verdict)}: ${formatWholeIn(projected.lowIn)} to ${formatWholeIn(projected.highIn)} in by ${formatShortDate(projected.targetDate)} (goal ${formatWholeIn(goalIn)}).`,
    },
  };
}

/**
 * Behind when the whole trend range sits under the required pace, ahead when
 * it sits over it, on pace when the range straddles it. The range is the
 * honest unit here: a point estimate alone would call a coin flip.
 */
export function paceVerdict(
  trend: TrendResult,
  requiredInPerWk: number,
): 'ahead' | 'on_pace' | 'behind' {
  if (trend.high < requiredInPerWk) return 'behind';
  if (trend.low > requiredInPerWk) return 'ahead';
  return 'on_pace';
}

function verdictWord(verdict: 'ahead' | 'on_pace' | 'behind'): string {
  switch (verdict) {
    case 'ahead':
      return 'Ahead of pace';
    case 'on_pace':
      return 'On pace';
    case 'behind':
      return 'Behind pace';
  }
}

/**
 * R110 house plateau: five canonical tests within the noise band. Reported
 * separately from the pace state so the generator can act on it without
 * reading a sentence.
 *
 * "Within +/-0.5 in" is read as two descriptive conditions on the last five
 * canonical session bests, both declared:
 *   they span no more than twice `plateau.bandIn`, so every test sits inside a
 *   1 in window, and
 *   the series has not drifted out of that window, that is the change from the
 *   first of the five to the last is no more than `plateau.bandIn`.
 * The second condition is what separates a plateau from slow real progress:
 *   five tests each 0.19 in above the one before also fit inside a 1 in
 *   window, and rotating exercise selection on real progress is exactly the
 *   wrong move.
 */
export function isPlateau(tests: JumpTest[], ruleset: Ruleset): boolean {
  const { tests: needed, bandIn } = ruleset.constants.plateau;
  const eligible = eligibleTests(tests);
  if (eligible.length < needed) return false;
  const window = eligible.slice(-needed);

  const values: number[] = [];
  for (const test of window) {
    const best = sessionBestMm(test);
    if (best === null) return false;
    values.push(mmToIn(best));
  }
  const first = values[0];
  const last = values[values.length - 1];
  if (first === undefined || last === undefined) return false;

  if (Math.max(...values) - Math.min(...values) > bandIn * 2) return false;
  return Math.abs(last - first) <= bandIn;
}
