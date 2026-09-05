/**
 * The readiness gate's words (house rule `house.sc.readiness_gate`).
 *
 * Every string here is built from the numbers the gate actually read, so the
 * session never shows an adjective without the figure behind it. The shape is
 * fixed: what each channel measured, then what the two of them together do to
 * today's session.
 *
 *   "Readiness: recovery 41% Low, throw 6.8 m (7-test median 7.1, within 5%).
 *    Autonomic low, neuromuscular fine: session as written, volume held."
 *
 * The action half is derived from the adjustment record rather than written
 * per state, so changing a magnitude in the ruleset changes the sentence too
 * and the two can never drift apart.
 */
import type {
  ReadinessAdjustment,
  ReadinessBand,
  ReadinessMetric,
  ReadinessTestKind,
} from '../types/readiness.js';
import { roundHalfUp } from '../units.js';

/** Whoop's own band vocabulary, kept verbatim (brief section 11). */
const WHOOP_BAND_WORD: Record<'low' | 'moderate' | 'high', string> = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
};

/** What the athlete calls the neuromuscular test in a sentence. */
const TEST_NOUN: Record<ReadinessTestKind, string> = {
  seated_mb_throw: 'throw',
  cmj: 'jump',
  rsi: 'RSI',
};

/** The unit the metric is displayed in; RSI is a ratio and carries none. */
const METRIC_UNIT: Record<ReadinessMetric, string> = {
  distance_m: 'm',
  height_in: 'in',
  rsi: '',
};

/** How many decimals each metric shows, so a median never reads as noise. */
const METRIC_DECIMALS: Record<ReadinessMetric, number> = {
  distance_m: 1,
  height_in: 1,
  rsi: 2,
};

/** The noun for one test kind: "throw", "jump", "RSI". */
export function readinessTestNoun(kind: ReadinessTestKind): string {
  return TEST_NOUN[kind];
}

/** One reading with its unit: "6.8 m", "29.4 in", "2.05". */
export function formatReadinessValue(value: number, metric: ReadinessMetric): string {
  const decimals = METRIC_DECIMALS[metric];
  const text = roundHalfUp(value, decimals).toFixed(decimals);
  const unit = METRIC_UNIT[metric];
  return unit === '' ? text : `${text} ${unit}`;
}

/** Channel A's half of the sentence: "recovery 41% Low", "no recovery score". */
export function autonomicFragment(
  score: number | null,
  band: 'low' | 'moderate' | 'high' | null,
): string {
  if (score === null || !Number.isFinite(score)) return 'no recovery score';
  const percent = `recovery ${Math.round(score)}%`;
  return band === null ? percent : `${percent} ${WHOOP_BAND_WORD[band]}`;
}

/** What the rolling median comparison says, in the parenthesis. */
export interface NeuromuscularCompare {
  /** How many prior tests the median was taken over. */
  baselineTests: number;
  /** The median itself, absent while the baseline is still calibrating. */
  median: number | null;
  /** How far below the median today sat, as a positive percent. */
  deficitPct: number;
  /** The configured band edge, the number "within 5%" names. */
  thresholdPct: number;
  /** Prior tests needed before the median is trusted. */
  minTests: number;
}

/**
 * Channel B's half: "throw 6.8 m (7-test median 7.1, within 5%)", or
 * "throw 6.8 m (calibrating, 2 of 3 tests)" while the baseline is short, or
 * "no output test today" when nothing was logged.
 */
export function neuromuscularFragment(
  kind: ReadinessTestKind,
  metric: ReadinessMetric,
  best: number | null,
  compare: NeuromuscularCompare,
): string {
  const noun = readinessTestNoun(kind);
  if (best === null) return `no ${noun} logged today`;
  const value = formatReadinessValue(best, metric);
  if (compare.median === null) {
    return `${noun} ${value} (calibrating, ${compare.baselineTests} of ${compare.minTests} tests)`;
  }
  // The unit rides on the reading in front of it, so the median stays a bare
  // number: "throw 6.8 m (7-test median 7.1, within 5%)".
  const median = roundHalfUp(compare.median, METRIC_DECIMALS[metric]).toFixed(
    METRIC_DECIMALS[metric],
  );
  const tail =
    compare.deficitPct > compare.thresholdPct
      ? `down ${Math.round(compare.deficitPct)}%`
      : `within ${compare.thresholdPct}%`;
  return `${noun} ${value} (${compare.baselineTests}-test median ${median}, ${tail})`;
}

/** A fragment on its own, as the channel's stored line. */
export function capitalize(text: string): string {
  return text.length === 0 ? text : `${text[0]?.toUpperCase() ?? ''}${text.slice(1)}`;
}

/** How the verdict names channel A. */
export function autonomicWord(band: ReadinessBand): string {
  if (band === 'high') return 'Autonomic fine';
  if (band === 'low') return 'Autonomic low';
  return 'Autonomic unknown';
}

/** How the verdict names channel B, second in the pair so it stays lowercase. */
export function neuromuscularWord(band: ReadinessBand): string {
  if (band === 'high') return 'neuromuscular fine';
  if (band === 'low') return 'neuromuscular low';
  return 'neuromuscular unknown';
}

/** A factor read as the percent it takes off: 0.75 becomes 25. */
function cutPct(factor: number): number {
  return Math.round((1 - factor) * 100);
}

/**
 * What the adjustment does, in plain words with its own numbers. Nothing here
 * describes a raise, because the ruleset loader refuses an adjustment that
 * could raise anything.
 *
 * @returns for example "maximal jumps out, jump volume down 25%, loads held"
 *   or "session as written, volume held".
 */
export function adjustmentClause(adjustment: ReadinessAdjustment): string {
  const parts: string[] = [];
  if (adjustment.removeMaximalJumps) parts.push('maximal jumps out');
  if (adjustment.jumpVolumeFactor < 1) {
    parts.push(`jump volume down ${cutPct(adjustment.jumpVolumeFactor)}%`);
  }
  if (adjustment.loadFactor < 1) parts.push(`loads down ${cutPct(adjustment.loadFactor)}%`);
  else if (adjustment.tierDown) parts.push('loads held');
  if (adjustment.extraReps > 0) {
    const reps = adjustment.extraReps === 1 ? 'rep' : 'reps';
    parts.push(`${adjustment.extraReps} more ${reps} a set`);
  }
  if (adjustment.holdVolume && !adjustment.tierDown) parts.push('volume held');

  const reduces =
    adjustment.tierDown ||
    adjustment.removeMaximalJumps ||
    adjustment.jumpVolumeFactor < 1 ||
    adjustment.loadFactor < 1 ||
    adjustment.extraReps > 0;
  if (!reduces) parts.unshift('session as written');
  return parts.join(', ');
}

/** The whole line the session shows above its blocks. */
export function readinessLine(
  autonomic: { band: ReadinessBand; fragment: string },
  neuromuscular: { band: ReadinessBand; fragment: string },
  adjustment: ReadinessAdjustment,
): string {
  const verdict = `${autonomicWord(autonomic.band)}, ${neuromuscularWord(neuromuscular.band)}`;
  const swap = adjustment.offerRecoverySwap ? ' You can move a recovery day here.' : '';
  return (
    `Readiness: ${autonomic.fragment}, ${neuromuscular.fragment}. ` +
    `${verdict}: ${adjustmentClause(adjustment)}.${swap}`
  );
}
