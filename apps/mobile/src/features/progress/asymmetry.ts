import {
  ASYMMETRY_THRESHOLDS,
  asymmetryTrend,
  readAsymmetry,
  readSideEffort,
  weakerSideFrom,
  type AsymmetryReading,
  type SidedSetInput,
} from '@vert/engine/analytics';
import type { SingleLegTest } from '@/data';
import { formatDayShort } from '../../ui/charts/scale';
import type { AsymmetryModel, AsymmetryRow } from './types';

/**
 * Asymmetry (house rule `house.sc.asymmetry_tracking`).
 *
 * Peak-force asymmetry is the second strongest correlate with wall time in the
 * owner's spec, and the gap decides which leg goes first on unilateral work.
 * A single-leg jump is its own mode: it never joins the jump stream, the
 * trend, the pace, or a PR, so it gets its own section and its own words.
 *
 * Every number here is recomputed from the two heights through the engine, so
 * a corrected rep changes the gap, the band, and the ordering together. The
 * section is absent until one test exists rather than showing an empty table.
 */

/** The three bands as one sentence, so the note has its scale beside it. */
export const ASYMMETRY_LEGEND =
  `Under ${ASYMMETRY_THRESHOLDS.watchFromPct}% balanced. ` +
  `${ASYMMETRY_THRESHOLDS.watchFromPct} to ${ASYMMETRY_THRESHOLDS.flagFromPct}% worth watching. ` +
  `Over ${ASYMMETRY_THRESHOLDS.flagFromPct}% wide enough to work on.`;

/** The word for a side, or "Level" when the gap is inside the band. */
export function sideWord(side: 'left' | 'right' | null): string {
  if (side === 'left') return 'Left';
  if (side === 'right') return 'Right';
  return 'Level';
}

/** A signed whole percent with a real minus sign: "−9%", "+7%", "0%". */
export function signedPct(pct: number): string {
  const whole = Math.round(Math.abs(pct));
  if (whole === 0) return '0%';
  return `${pct < 0 ? '−' : '+'}${whole}%`;
}

/** One decimal on a height, the way every other inch on the screen reads. */
function inches(value: number): string {
  return value.toFixed(1);
}

/** What the athlete does about the band the latest test landed in. */
export function asymmetryNote(reading: AsymmetryReading): string {
  if (reading.band === 'balanced') {
    return `Inside the band. Neither leg leads on unilateral work for a gap this size.`;
  }
  const side = sideWord(reading.weakerSide).toLowerCase();
  if (reading.band === 'watch') {
    return `Worth watching. The ${side} leg goes first on unilateral work while the gap holds.`;
  }
  return `Wide enough to work on. The ${side} leg goes first on unilateral work, every set.`;
}

export interface AsymmetryInput {
  readonly tests: readonly SingleLegTest[];
  /** The athlete's own answer, used only when no test names a side. */
  readonly answer: 'left' | 'right' | null;
  /** A signed gap inside this many percent reads as level. */
  readonly bandPct: number;
  /**
   * Every loaded set on file. The ones logged per side carry an effort gap,
   * which names the harder-working leg between test days and is what the
   * plan's own unilateral rows are ordered by. Passing the whole list is
   * deliberate: the engine decides what pairs, this screen does not.
   */
  readonly liftSets?: readonly SidedSetInput[];
}

/**
 * The Asymmetry section, or null before the first single-leg test.
 *
 * Never a trend line: two or three single-leg tests cannot carry Theil-Sen, so
 * the direction is the engine's first-gap-to-latest-gap reading and nothing
 * more, and it only appears once two tests exist.
 */
export function buildAsymmetry(input: AsymmetryInput): AsymmetryModel | null {
  const sorted = [...input.tests].sort((a, b) =>
    a.localDate < b.localDate ? -1 : a.localDate > b.localDate ? 1 : 0,
  );
  const latest = sorted[sorted.length - 1];
  if (latest === undefined) return null;

  const engineTests = sorted.map((test) => ({
    date: test.localDate,
    instrument: test.instrument,
    leftIn: test.leftIn,
    rightIn: test.rightIn,
    asymmetryPct: test.asymmetryPct,
    weakerSide: test.weakerSide,
  }));

  const readings = engineTests.map((test) => readAsymmetry(test));
  const latestReading = readings[readings.length - 1];
  if (latestReading === undefined) return null;

  const rows: AsymmetryRow[] = readings
    .map((reading, index): AsymmetryRow => {
      const source = sorted[index];
      return {
        id: source?.id ?? `${reading.date}-${index}`,
        date: reading.date,
        dateLabel: formatDayShort(reading.date),
        leftIn: inches(reading.leftIn),
        rightIn: inches(reading.rightIn),
        pct: signedPct(reading.pct),
        weakerSide: sideWord(reading.weakerSide),
        band: reading.band,
      };
    })
    .reverse();

  // The same reading the plan orders its unilateral rows by, so the two
  // surfaces can never name different legs.
  const effort = readSideEffort(input.liftSets ?? []);
  const weakerSide = weakerSideFrom(
    engineTests,
    input.answer,
    input.bandPct,
    effort?.harderSide ?? null,
  );
  const trend = asymmetryTrend(engineTests);

  return {
    rows,
    latestLine: latestReading.line,
    note: asymmetryNote(latestReading),
    legend: ASYMMETRY_LEGEND,
    trendLine: trend === null ? null : trend.line,
    effortLine: effort === null ? null : effort.line,
    weakerSide,
    orderLine:
      weakerSide === null
        ? 'No side is named, so unilateral work runs in the order it is written.'
        : `${sideWord(weakerSide)} leg first on every unilateral set.`,
  };
}
