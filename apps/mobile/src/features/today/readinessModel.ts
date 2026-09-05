import type {
  ReadinessAdjustment,
  ReadinessOutcome,
  ReadinessTestConfig,
  ReadinessTestSession,
  ReadinessWhoopInput,
} from '@vert/engine';
import {
  RULESET_V1,
  adjustmentClause,
  autonomicWord,
  formatReadinessValue,
  neuromuscularWord,
  readinessSuffixFor,
  readinessTestNoun,
  scoreReadiness,
} from '@vert/engine';
import type { ReadinessTestSession as TestRow } from '@/data';
import { recoveryBand } from './strip';

/**
 * The readiness row's model: two channels, never averaged
 * (house rule `house.sc.readiness_gate`).
 *
 * Channel A is autonomic and comes off the strap; channel B is neuromuscular
 * and comes off a throw the athlete makes here. Everything that decides is the
 * engine's `scoreReadiness`: this file only turns the store's rows into its
 * inputs and its answer into the four strings the row draws. Nothing here
 * colours a state, because a colour is not a reading.
 */

/** The day's answer, as the row shows it. */
export interface ReadinessRowModel {
  /** Absent until one channel has data; the row is then one caption line. */
  readonly outcome: ReadinessOutcome | null;
  /** "Recovery 73% High. Data by WHOOP", or what is known instead. */
  readonly autonomicLine: string;
  /** "Throw 7.2 m (9-test median 7.1, within 5%)." */
  readonly neuromuscularLine: string;
  /**
   * The verdict in words, absent while neither channel has anything to say:
   * "Autonomic low, neuromuscular fine: session as written, volume held." The
   * two channel lines above carry the readings, so this half never repeats
   * them.
   */
  readonly outcomeLine: string | null;
  /** "· Readiness: one tier down", when the gate actually changed the day. */
  readonly suffix: string | null;
  /** "Log throw", or "Change" once today's test is in. */
  readonly actionLabel: string;
  /** True once today's test is logged, so the row can offer to change it. */
  readonly logged: boolean;
  /** The line the row falls back to when neither channel has data. */
  readonly caption: string;
}

export interface ReadinessRowInput {
  readonly config: ReadinessTestConfig;
  /** That morning's recovery, or null on a day the strap did not score. */
  readonly whoop: ReadinessWhoopInput | null;
  readonly test: ReadinessTestSession | null;
  readonly history: readonly ReadinessTestSession[];
}

/**
 * Whoop's day as channel A reads it. The band is Whoop's own word at its own
 * 33 and 66 cuts, taken from the strip so one file decides what "High" means.
 */
export function whoopChannel(
  day: { readonly date: string; readonly score: number | null } | null,
): ReadinessWhoopInput | null {
  if (day === null) return null;
  const score = day.score;
  return {
    date: day.date,
    score,
    band: score === null ? null : recoveryBand(score),
  };
}

/** A stored test row as the engine reads it. A row with no best is not a test. */
export function toEngineTest(row: TestRow | null | undefined): ReadinessTestSession | null {
  if (row == null || row.best === null) return null;
  return {
    id: row.id,
    date: row.localDate,
    kind: row.kind,
    attempts: [...row.attempts],
    best: row.best,
    unit: row.unit,
  };
}

/** Every stored row that is a usable test, oldest first. */
export function toEngineTests(rows: readonly TestRow[]): ReadinessTestSession[] {
  const out: ReadinessTestSession[] = [];
  for (const row of rows) {
    const test = toEngineTest(row);
    if (test !== null) out.push(test);
  }
  return out;
}

/** True when the gate's answer leaves today's session exactly as it was. */
export function isNoOpAdjustment(adjustment: ReadinessAdjustment): boolean {
  return (
    !adjustment.tierDown &&
    !adjustment.removeMaximalJumps &&
    adjustment.jumpVolumeFactor >= 1 &&
    adjustment.loadFactor >= 1 &&
    adjustment.extraReps === 0
  );
}

/** True when the gate had nothing at all to read: neither channel scored. */
export function isSilent(outcome: ReadinessOutcome): boolean {
  return outcome.channels[0].band === 'unknown' && outcome.channels[1].band === 'unknown';
}

/**
 * What the two bands do to today's session, in the engine's own words. This is
 * the second half of the engine's `readinessLine`, built from the same three
 * exports, so the row and the session notice can never say different things.
 */
export function verdictLine(outcome: ReadinessOutcome): string {
  const [autonomic, neuromuscular] = outcome.channels;
  const swap = outcome.adjustment.offerRecoverySwap
    ? ' You can move a recovery day here.'
    : '';
  const verdict = `${autonomicWord(autonomic.band)}, ${neuromuscularWord(neuromuscular.band)}`;
  return `${verdict}: ${adjustmentClause(outcome.adjustment)}.${swap}`;
}

/**
 * Score the day and turn it into the row.
 *
 * The gate is always scored, even on a day with one channel or none, because
 * the row's job is to say what is known. What the session does with the answer
 * is decided elsewhere: a silent day carries no line and no suffix.
 */
export function readinessRowModel({
  config,
  whoop,
  test,
  history,
}: ReadinessRowInput): ReadinessRowModel {
  const outcome = scoreReadiness(config, whoop, test, history, RULESET_V1);
  const [autonomic, neuromuscular] = outcome.channels;
  const silent = isSilent(outcome);
  const caption = `${autonomic.line} ${neuromuscular.line}`;

  return {
    outcome: silent ? null : outcome,
    autonomicLine: autonomic.line,
    neuromuscularLine: neuromuscular.line,
    outcomeLine: silent ? null : verdictLine(outcome),
    suffix: readinessSuffixFor(outcome) ?? null,
    actionLabel: test === null ? logLabel(config) : 'Change',
    logged: test !== null,
    caption,
  };
}

/** "Log throw", "Log jump", "Log RSI": the verb and the test's own noun. */
export function logLabel(config: ReadinessTestConfig): string {
  return `Log ${readinessTestNoun(config.kind)}`;
}

/** "7.2 m", "29.4 in", "2.05": the attempt as its metric shows it. */
export function attemptText(value: number, config: ReadinessTestConfig): string {
  return formatReadinessValue(value, config.metric);
}

/** "Log throw" and then "Save throw": the same noun for the same test. */
export function saveLabel(config: ReadinessTestConfig): string {
  return `Save ${readinessTestNoun(config.kind)}`;
}

/** The step one tap of the entry moves: 0.1 m on a throw, 0.1 in on a jump. */
export const ATTEMPT_STEP: Readonly<Record<string, number>> = {
  distance_m: 0.1,
  height_in: 0.1,
  rsi: 0.01,
};

export function attemptStep(config: ReadinessTestConfig): number {
  return ATTEMPT_STEP[config.metric] ?? 0.1;
}

/** The unit shown after the stepper: "m", "in", or nothing for a ratio. */
export const ATTEMPT_UNIT: Readonly<Record<string, string>> = {
  distance_m: 'm',
  height_in: 'in',
  rsi: '',
};

export function attemptUnit(config: ReadinessTestConfig): string {
  return ATTEMPT_UNIT[config.metric] ?? '';
}

/**
 * The unit the test row is stored under: "m", "in", or "RSI". A ratio has no
 * unit to print beside a stepper but still needs a name in the record.
 */
export function testUnit(config: ReadinessTestConfig): string {
  const unit = attemptUnit(config);
  return unit === '' ? 'RSI' : unit;
}

/**
 * The attempt as a bare number: "7.2", "29.4", "2.05".
 *
 * The stepper is typed into, so what it prints has to be what a numeric parser
 * will take back, with the unit carried in the suffix beside it. The rounding
 * is still the engine's: the unit is removed from its reading rather than the
 * decimals being decided a second time here.
 */
export function bareAttemptText(value: number, config: ReadinessTestConfig): string {
  const unit = attemptUnit(config);
  const text = attemptText(value, config);
  return unit === '' ? text : text.slice(0, Math.max(0, text.length - unit.length - 1));
}

/** The best of the day's attempts. Nothing typed is not a zero. */
export function bestOf(attempts: readonly (number | null)[]): number | null {
  const usable = attempts.filter(
    (value): value is number => value !== null && Number.isFinite(value) && value > 0,
  );
  return usable.length === 0 ? null : Math.max(...usable);
}

/** "Best 7.2 m of 3 attempts", the line under the entry. */
export function bestLine(
  attempts: readonly (number | null)[],
  config: ReadinessTestConfig,
): string {
  const best = bestOf(attempts);
  const typed = attempts.filter((value) => value !== null && value > 0).length;
  if (best === null) return `Best of ${config.attempts} attempts`;
  return `Best ${attemptText(best, config)} of ${typed} ${typed === 1 ? 'attempt' : 'attempts'}`;
}
