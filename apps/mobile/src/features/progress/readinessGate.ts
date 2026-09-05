import type {
  ReadinessMetric,
  ReadinessState,
  ReadinessTestConfig,
  ReadinessTestSession as EngineReadinessTest,
  ReadinessWhoopInput,
  Ruleset,
} from '@vert/engine';
import {
  adjustmentClause,
  adjustmentFor,
  autonomicWord,
  formatReadinessValue,
  neuromuscularWord,
  readinessTestNoun,
  scoreReadiness,
} from '@vert/engine';
import type { LocalDate, ReadinessTestSession, WhoopRecovery } from '@/data';
import { addDays, formatDayShort, recoveryBand } from '../../ui/charts/scale';
import type {
  ReadinessGateDay,
  ReadinessGateModel,
  ReadinessLegendItem,
  ReadinessStateName,
} from './types';

/**
 * The readiness gate on Progress (house rule `house.sc.readiness_gate`).
 *
 * Two channels, never averaged, so they are drawn as two rows of dots on one
 * date axis rather than as one score: the autonomic row is the Whoop recovery
 * band in Whoop's own vocabulary, the neuromuscular row is the configured
 * output test against its rolling median. Divergence between them is the
 * signal the whole gate is built on, so a day where the two disagree carries a
 * glyph and the word beside it and is counted in the section's summary.
 *
 * Every band here comes from the engine's own `scoreReadiness`, run once a
 * day over that day's history, so the section can never disagree with the line
 * the session showed on the morning it ran.
 */

/** How far back the two rows reach. Thirty days is the readable width. */
export const GATE_WINDOW_DAYS = 30;

/** The four states, in the order the owner's spec lists them, then unknown. */
const LEGEND_ORDER: readonly ReadinessStateName[] = [
  'both_high',
  'autonomic_low',
  'neuromuscular_low',
  'both_low',
];

/** The two bands each state is made of. Fixed: autonomic first, always. */
const LEGEND_BANDS: Readonly<
  Record<ReadinessStateName, readonly ['high' | 'low' | 'unknown', 'high' | 'low' | 'unknown']>
> = {
  both_high: ['high', 'high'],
  autonomic_low: ['low', 'high'],
  neuromuscular_low: ['high', 'low'],
  both_low: ['low', 'low'],
  unknown: ['unknown', 'unknown'],
};

/** A short title for one state, in words rather than in a colour. */
const LEGEND_TITLE: Readonly<Record<ReadinessStateName, string>> = {
  both_high: 'Both high',
  autonomic_low: 'Autonomic low only',
  neuromuscular_low: 'Neuromuscular low only',
  both_low: 'Both low',
  unknown: 'Not enough to score',
};

/** The store's readiness row as the engine reads it. Unlogged days are dropped. */
export function toEngineReadinessTest(row: ReadinessTestSession): EngineReadinessTest | null {
  if (row.best === null || !Number.isFinite(row.best)) return null;
  return {
    id: row.id,
    date: row.localDate,
    kind: row.kind,
    attempts: [...row.attempts],
    best: row.best,
    unit: row.unit,
  };
}

/** That morning's recovery as channel A reads it. A pending day is not a low one. */
export function toWhoopInput(row: WhoopRecovery | undefined): ReadinessWhoopInput | null {
  if (row === undefined) return null;
  const score = row.scoreState === 'SCORED' ? row.recoveryScore : null;
  return { date: row.localDate, score, band: score === null ? null : recoveryBand(score) };
}

export interface ReadinessGateInput {
  readonly today: LocalDate;
  readonly config: ReadinessTestConfig;
  readonly tests: readonly ReadinessTestSession[];
  readonly recovery: readonly WhoopRecovery[];
  readonly ruleset: Ruleset;
  /** Overridable so a test can read a shorter window than a month. */
  readonly windowDays?: number;
}

/** The four states spelled out in the engine's own words, magnitudes included. */
export function readinessLegend(ruleset: Ruleset): ReadinessLegendItem[] {
  return LEGEND_ORDER.map((state): ReadinessLegendItem => {
    const bands = LEGEND_BANDS[state];
    const adjustment = adjustmentFor(state as ReadinessState, ruleset);
    return {
      state,
      title: LEGEND_TITLE[state],
      line: `${autonomicWord(bands[0])}, ${neuromuscularWord(bands[1])}: ${adjustmentClause(adjustment)}.`,
      diverged: state === 'autonomic_low' || state === 'neuromuscular_low',
    };
  });
}

/**
 * One row per calendar day in the window, both channels kept apart.
 *
 * A day with neither channel is left out entirely rather than drawn as a gap
 * in two rows: the axis is the days the gate had something to say about, and a
 * month of empty slots would make the two rows unreadable on a phone.
 */
export function buildReadinessGate(input: ReadinessGateInput): ReadinessGateModel | null {
  const window = input.windowDays ?? GATE_WINDOW_DAYS;
  const from = addDays(input.today, -(window - 1));
  const metric: ReadinessMetric = input.config.metric;

  const engineTests: EngineReadinessTest[] = [];
  for (const row of input.tests) {
    if (row.kind !== input.config.kind) continue;
    const converted = toEngineReadinessTest(row);
    if (converted !== null) engineTests.push(converted);
  }
  engineTests.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const recoveryByDay = new Map<string, WhoopRecovery>();
  for (const row of input.recovery) recoveryByDay.set(row.localDate, row);

  const days: ReadinessGateDay[] = [];
  for (let offset = 0; offset < window; offset += 1) {
    const date = addDays(from, offset);
    if (date > input.today) break;
    const whoop = toWhoopInput(recoveryByDay.get(date));
    const test = engineTests.find((entry) => entry.date === date) ?? null;
    const history = engineTests.filter((entry) => entry.date < date);
    if (whoop === null && test === null) continue;

    const outcome = scoreReadiness(input.config, whoop, test, history, input.ruleset);
    const [autonomic, neuromuscular] = outcome.channels;
    const state = outcome.state as ReadinessStateName;
    const diverged = state === 'autonomic_low' || state === 'neuromuscular_low';
    const score = whoop?.score ?? null;
    const testValue = test === null ? null : formatReadinessValue(test.best, metric);

    days.push({
      date,
      dateLabel: formatDayShort(date),
      autonomic: autonomic.band,
      neuromuscular: neuromuscular.band,
      state,
      diverged,
      recoveryBand: whoop?.band ?? null,
      recoveryScore: score,
      testValue,
      label: `${formatDayShort(date)}: ${autonomic.line} ${neuromuscular.line}`,
    });
  }

  if (days.length === 0) return null;

  const divergenceCount = days.filter((day) => day.diverged).length;
  const first = days[0];
  const last = days[days.length - 1];
  const todayDay = days.find((day) => day.date === input.today);
  const todayOutcome =
    todayDay === undefined
      ? null
      : scoreReadiness(
          input.config,
          toWhoopInput(recoveryByDay.get(input.today)),
          engineTests.find((entry) => entry.date === input.today) ?? null,
          engineTests.filter((entry) => entry.date < input.today),
          input.ruleset,
        ).line;

  return {
    days,
    fromLabel: formatDayShort(first?.date ?? from),
    toLabel: formatDayShort(last?.date ?? input.today),
    divergenceCount,
    divergenceLine: divergenceLine(divergenceCount, days.length),
    legend: readinessLegend(input.ruleset),
    todayLine: todayOutcome,
    testNoun: readinessTestNoun(input.config.kind),
  };
}

/** "3 divergence days in 21 scored", or the honest zero. */
export function divergenceLine(diverged: number, scored: number): string {
  const dayWord = scored === 1 ? 'day' : 'days';
  if (diverged === 0) {
    return `No divergence days in ${scored} scored ${dayWord}. The two channels agreed every time.`;
  }
  const label = diverged === 1 ? 'divergence day' : 'divergence days';
  return `${diverged} ${label} in ${scored} scored ${dayWord}. Divergence is the signal, not the average.`;
}
