/**
 * The readiness gate (house rule `house.sc.readiness_gate`).
 *
 * Two channels, never averaged. Channel A is autonomic: the Whoop recovery
 * band, where Moderate counts as high unless the score is under
 * `config.whoopLowScore`. Channel B is neuromuscular: the configured output
 * test, scored against the rolling median of the last `config.baselineWindow`
 * sessions, where within `config.lowThresholdPct` reads high and further below
 * reads low. Divergence between the two is the signal, so the four combined
 * states each carry their own adjustment.
 *
 * Three invariants hold for every adjustment, and the ruleset loader refuses a
 * file that breaks them: adjustments only ever reduce, they are explained on
 * the session in plain words, and they apply to today's session alone. The
 * gate runs when both channels have data; with one channel missing it reports
 * what it knows and adjusts on that channel alone only when the one it has is
 * the neuromuscular one.
 */
import type { Ruleset } from '../types/ruleset.js';
import type {
  ReadinessAdjustment,
  ReadinessBand,
  ReadinessChannel,
  ReadinessOutcome,
  ReadinessState,
  ReadinessTestConfig,
  ReadinessTestSession,
  ReadinessWhoopInput,
} from '../types/readiness.js';
import {
  autonomicFragment,
  capitalize,
  neuromuscularFragment,
  readinessLine,
} from './lines.js';
import type { NeuromuscularCompare } from './lines.js';

export * from './lines.js';
export * from './apply.js';

/** The house rule every readiness line and every adjustment is filed under. */
export const READINESS_HOUSE_RULE_ID = 'house.sc.readiness_gate';

/**
 * Prior sessions of the same test needed before the rolling median is trusted.
 * Under this the channel reads `unknown` and the line says calibrating, so the
 * gate never cuts a session on a baseline of one or two throws.
 */
export const MIN_BASELINE_TESTS = 3;

/** Float slack, so a reading exactly on the threshold reads as within it. */
const EPSILON = 1e-9;

/** A channel's reading plus the half-sentence the combined line uses. */
interface ChannelReading {
  channel: ReadinessChannel;
  fragment: string;
}

/**
 * The middle value of a set of readings. Even counts take the mean of the two
 * middle ones, so a six-test window is not silently biased low.
 *
 * @returns null for an empty input.
 */
export function rollingMedian(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const low = sorted[middle - 1];
  const high = sorted[middle];
  if (low === undefined || high === undefined) return null;
  return (low + high) / 2;
}

/**
 * The sessions the median is taken over: same test kind, earlier than today's,
 * oldest first, most recent `baselineWindow` of them.
 */
function baselineSessions(
  config: ReadinessTestConfig,
  today: ReadinessTestSession | null,
  history: readonly ReadinessTestSession[],
): ReadinessTestSession[] {
  const priors = history
    .filter((entry) => entry.kind === config.kind)
    .filter((entry) => today === null || (entry.id !== today.id && entry.date <= today.date))
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (priors.length < MIN_BASELINE_TESTS) return priors;
  const window = Math.max(1, Math.floor(config.baselineWindow));
  return priors.slice(-window);
}

/**
 * Channel A. A High or Moderate band reads high unless the score itself sits
 * under `whoopLowScore`; a Low band reads low; a day with no score at all
 * reads unknown, because a missing number is not a low one.
 */
function readAutonomic(
  config: ReadinessTestConfig,
  whoop: ReadinessWhoopInput | null,
): ChannelReading {
  if (whoop === null || whoop.score === null || !Number.isFinite(whoop.score)) {
    const fragment = autonomicFragment(null, null);
    return {
      channel: { name: 'autonomic', band: 'unknown', line: `${capitalize(fragment)} for today.` },
      fragment,
    };
  }
  const score = whoop.score;
  const band: ReadinessBand =
    whoop.band === 'low' || score < config.whoopLowScore ? 'low' : 'high';
  const fragment = autonomicFragment(score, whoop.band);
  return {
    channel: {
      name: 'autonomic',
      value: score,
      band,
      line: `${capitalize(fragment)}. Data by WHOOP`,
    },
    fragment,
  };
}

/**
 * Channel B. Within `lowThresholdPct` of the rolling median reads high, more
 * than that below reads low, and fewer than `MIN_BASELINE_TESTS` prior tests
 * reads unknown while the baseline calibrates.
 */
function readNeuromuscular(
  config: ReadinessTestConfig,
  today: ReadinessTestSession | null,
  history: readonly ReadinessTestSession[],
): ChannelReading {
  const priors = baselineSessions(config, today, history);
  const usable = today !== null && Number.isFinite(today.best) && today.best > 0;
  const median = priors.length < MIN_BASELINE_TESTS ? null : rollingMedian(priors.map((p) => p.best));
  const trusted = median !== null && median > 0;
  const best = usable && today !== null ? today.best : null;
  const deficitPct = trusted && best !== null ? ((median - best) / median) * 100 : 0;

  const compare: NeuromuscularCompare = {
    baselineTests: priors.length,
    median: trusted ? median : null,
    deficitPct,
    thresholdPct: config.lowThresholdPct,
    minTests: MIN_BASELINE_TESTS,
  };
  const fragment = neuromuscularFragment(config.kind, config.metric, best, compare);

  let band: ReadinessBand = 'unknown';
  if (best !== null && trusted) {
    band = deficitPct <= config.lowThresholdPct + EPSILON ? 'high' : 'low';
  }
  const channel: ReadinessChannel = {
    name: 'neuromuscular',
    band,
    line: `${capitalize(fragment)}.`,
  };
  if (best !== null) channel.value = best;
  return { channel, fragment };
}

/**
 * The two bands combined, never averaged. A neuromuscular channel with no
 * usable reading leaves the day unadjusted whatever the recovery score said,
 * and a missing recovery score with a low neuromuscular reading is still a
 * neuromuscular-low day.
 */
export function combineBands(autonomic: ReadinessBand, neuromuscular: ReadinessBand): ReadinessState {
  if (neuromuscular === 'unknown') return 'unknown';
  if (neuromuscular === 'low') return autonomic === 'low' ? 'both_low' : 'neuromuscular_low';
  if (autonomic === 'low') return 'autonomic_low';
  if (autonomic === 'high') return 'both_high';
  return 'unknown';
}

/**
 * Score both channels and combine them into one of the five states, with the
 * adjustment and the plain-words line the session shows.
 *
 * @param config the swappable test configuration, from the athlete when they
 *   set one and from `constants.climbing.readiness` otherwise.
 * @param whoop that morning's recovery, or null when the day was not scored.
 * @param today the neuromuscular test logged today, or null when none was.
 * @param history earlier sessions of the same test, any order; the rolling
 *   median is taken over the most recent `config.baselineWindow` of them.
 * @param ruleset read for `constants.climbing.readinessAdjustments`.
 * @returns the state, both channels in autonomic-then-neuromuscular order,
 *   the adjustment, the line, and `READINESS_HOUSE_RULE_ID`.
 */
export function scoreReadiness(
  config: ReadinessTestConfig,
  whoop: ReadinessWhoopInput | null,
  today: ReadinessTestSession | null,
  history: readonly ReadinessTestSession[],
  ruleset: Ruleset,
): ReadinessOutcome {
  const autonomic = readAutonomic(config, whoop);
  const neuromuscular = readNeuromuscular(config, today, history);
  const state = combineBands(autonomic.channel.band, neuromuscular.channel.band);
  const adjustment = adjustmentFor(state, ruleset);
  const line = readinessLine(
    { band: autonomic.channel.band, fragment: autonomic.fragment },
    { band: neuromuscular.channel.band, fragment: neuromuscular.fragment },
    adjustment,
  );
  return {
    state,
    channels: [autonomic.channel, neuromuscular.channel],
    adjustment,
    line,
    houseRuleId: READINESS_HOUSE_RULE_ID,
  };
}

/**
 * The adjustment one state carries. A pure lookup into the ruleset, so the
 * magnitudes are data the Plan can render and never numbers in code. The
 * loader has already refused any entry that would raise a load, a jump volume
 * or a rep count, so everything this returns reduces or holds.
 */
export function adjustmentFor(state: ReadinessState, ruleset: Ruleset): ReadinessAdjustment {
  return ruleset.constants.climbing.readinessAdjustments[state];
}
