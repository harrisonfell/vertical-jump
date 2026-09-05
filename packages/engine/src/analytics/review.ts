/**
 * The weekly review line, the first thing Progress says (brief section 05):
 *
 *   "Week 7 of 12 - 3/3 (100%) - progressed - test 32.5 in - trend
 *    +0.30 in/wk, need +0.29 - avg recovery 61 - load 1,840 sRPE"
 *
 * (the separators above are the real middle dot in the output). Every segment
 * is optional except the week and the sessions: a week with no test, no trend,
 * and no Whoop connection drops those parts rather than printing zeros.
 */
import type { WeekOutcome } from '../types/logs.js';
import { mmToIn } from '../units.js';
import {
  formatCount,
  formatInValue,
  formatPercentWhole,
  formatRateInPerWk,
  formatRateValue,
  joinParts,
} from './format.js';

/** Typed inputs for one week's line. Nothing is derived from a screen. */
export interface WeeklyReviewInput {
  weekNumber: number;
  programWeeks: number;
  /** Sessions marked complete that calendar week, Recovery days included. */
  completed: number;
  /** Sessions scheduled that calendar week. */
  scheduled: number;
  /** The outcome the engine applied, or null before the week is decided. */
  outcome?: WeekOutcome | null;
  /** Best canonical attempt of the week's test, in millimetres. */
  testMm?: number | null;
  trendInPerWk?: number | null;
  requiredInPerWk?: number | null;
  /** Mean Whoop recovery over the week, 0 to 100. */
  avgRecovery?: number | null;
  /** Session RPE times minutes, summed over the week. */
  loadSrpe?: number | null;
}

/** Past tense, because the week is over (brief section 05 "Weekly review"). */
export function outcomeWord(outcome: WeekOutcome): string {
  switch (outcome) {
    case 'progress':
      return 'progressed';
    case 'small':
      return 'small step';
    case 'hold':
      return 'held';
    case 'repeat':
      return 'repeated';
  }
}

/** Build the line. Segments that have no data are dropped, never zeroed. */
export function weeklyReviewLine(input: WeeklyReviewInput): string {
  const pct =
    input.scheduled > 0 ? formatPercentWhole(input.completed / input.scheduled) : '0%';

  const trendPart =
    input.trendInPerWk === null || input.trendInPerWk === undefined
      ? null
      : input.requiredInPerWk === null || input.requiredInPerWk === undefined
        ? `trend ${formatRateInPerWk(input.trendInPerWk)}`
        : `trend ${formatRateInPerWk(input.trendInPerWk)}, need ${formatRateValue(input.requiredInPerWk)}`;

  return joinParts([
    `Week ${input.weekNumber} of ${input.programWeeks}`,
    `${input.completed}/${input.scheduled} (${pct})`,
    input.outcome ? outcomeWord(input.outcome) : null,
    input.testMm === null || input.testMm === undefined
      ? null
      : `test ${formatInValue(mmToIn(input.testMm))} in`,
    trendPart,
    input.avgRecovery === null || input.avgRecovery === undefined
      ? null
      : `avg recovery ${formatCount(input.avgRecovery)}`,
    input.loadSrpe === null || input.loadSrpe === undefined
      ? null
      : `load ${formatCount(input.loadSrpe)} sRPE`,
  ]);
}
