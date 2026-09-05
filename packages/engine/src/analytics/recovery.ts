/**
 * The "Recovery vs output" table (brief section 08 "Earning autoregulation").
 * Three Whoop recovery bands, each with n sessions, median RPE, percent heavy
 * legs, n tests, and the median test residual. Whoop's own hairlines are at 33
 * and 66, so Low is 0 to 33, Moderate 34 to 66, High 67 to 100.
 *
 * The table stays collapsed to a counter line until one band has six sessions,
 * because a two-session band would invite a conclusion the data cannot carry.
 * Rule-book adjustments (soreness, pain) are logged separately from the shadow
 * modifier, so nothing here is contaminated by an adjustment the app made.
 */
import { median } from './theilSen.js';
import { formatInDelta, formatInValue, formatPercentWhole } from './format.js';

/** The three bands, in Whoop's own vocabulary. */
export type RecoveryBand = 'low' | 'moderate' | 'high';

/** One session paired with that morning's recovery. */
export interface RecoverySession {
  /** Whoop recovery score, 0 to 100. */
  recovery: number;
  /** Session RPE. */
  rpe?: number | null;
  legsFeel?: 'fresh' | 'normal' | 'heavy' | null;
}

/** One canonical test paired with that morning's recovery. */
export interface RecoveryTest {
  recovery: number;
  /** Test height minus the trend's fitted value, in inches. */
  residualIn: number;
}

/** One row of the table. */
export interface RecoveryOutputRow {
  band: RecoveryBand;
  /** "Low", "Moderate", "High": paired with the color, never replaced by it. */
  label: string;
  sessions: number;
  medianRpe: number | null;
  /** Share of sessions answering Heavy, 0 to 1. Null with no answers. */
  heavyLegsFraction: number | null;
  tests: number;
  medianResidualIn: number | null;
}

/** The table, or the counter line that stands in for it. */
export interface RecoveryOutputTable {
  rows: RecoveryOutputRow[];
  /** True once one band has `sessionsPerBand` sessions. */
  ready: boolean;
  /** The line shown while the table is still collapsed. Null once ready. */
  counterLine: string | null;
  sessionsPerBand: number;
}

const BAND_LABEL: Record<RecoveryBand, string> = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
};

const BAND_ORDER: readonly RecoveryBand[] = ['low', 'moderate', 'high'];

/** Whoop's bands, with the hairlines at 33 and 66. */
export function recoveryBand(recovery: number): RecoveryBand {
  if (recovery <= 33) return 'low';
  if (recovery <= 66) return 'moderate';
  return 'high';
}

function medianOrNull(values: number[]): number | null {
  return values.length === 0 ? null : median(values);
}

/** Build the table, or the counter line that precedes it. */
export function recoveryOutputTable(
  sessions: readonly RecoverySession[],
  tests: readonly RecoveryTest[],
  sessionsPerBand = 6,
): RecoveryOutputTable {
  const rows = BAND_ORDER.map((band): RecoveryOutputRow => {
    const inBand = sessions.filter((session) => recoveryBand(session.recovery) === band);
    const rpes = inBand
      .map((session) => session.rpe)
      .filter((rpe): rpe is number => typeof rpe === 'number');
    const answered = inBand.filter(
      (session) => session.legsFeel === 'fresh' || session.legsFeel === 'normal' || session.legsFeel === 'heavy',
    );
    const heavy = answered.filter((session) => session.legsFeel === 'heavy').length;
    const bandTests = tests.filter((test) => recoveryBand(test.recovery) === band);
    return {
      band,
      label: BAND_LABEL[band],
      sessions: inBand.length,
      medianRpe: medianOrNull(rpes),
      heavyLegsFraction: answered.length === 0 ? null : heavy / answered.length,
      tests: bandTests.length,
      medianResidualIn: medianOrNull(bandTests.map((test) => test.residualIn)),
    };
  });

  const ready = rows.some((row) => row.sessions >= sessionsPerBand);
  const counts = rows.map((row) => `${row.label} ${row.sessions}`).join(', ');
  return {
    rows,
    ready,
    counterLine: ready
      ? null
      : `Recovery vs output: needs ${sessionsPerBand} sessions in one band (${counts}).`,
    sessionsPerBand,
  };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** One row as the table prints it, for the compact list on a phone. */
export function recoveryOutputRowLine(row: RecoveryOutputRow): string {
  const rpe = row.medianRpe === null ? 'no RPE' : `median RPE ${formatInValue(row.medianRpe)}`;
  const heavy =
    row.heavyLegsFraction === null
      ? 'no legs answer'
      : `${formatPercentWhole(row.heavyLegsFraction)} heavy legs`;
  const residual =
    row.medianResidualIn === null
      ? 'no tests'
      : `${plural(row.tests, 'test')}, median residual ${formatInDelta(row.medianResidualIn)} in`;
  return `${row.label}: ${plural(row.sessions, 'session')}, ${rpe}, ${heavy}, ${residual}`;
}
