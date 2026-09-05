/**
 * The readiness gate and the single-leg asymmetry stream.
 *
 * House rule `house.sc.readiness_gate` (owner's athlete spec, "Readiness
 * Gate"): two channels, never averaged. Channel A is autonomic (the Whoop
 * recovery band), channel B is neuromuscular (a configured output test,
 * default the seated med-ball throw). Divergence is the signal, so the four
 * combined states drive the day's adjustment; every adjustment is downward
 * only, is explained on the session, is undone by changing the answer, and
 * applies to today's session alone. The test itself is configuration, not a
 * constant, so the athlete may swap it for a CMJ or an RSI drop jump.
 *
 * House rule `house.sc.asymmetry_tracking`: single-leg jump tests are their
 * own mode. They feed the weaker-side ordering and the Progress asymmetry
 * section; they are never a canonical test and never a PR.
 */
import type { Instrument, Side } from './core.js';
import type { LocalDate } from './calendar.js';

/** Which output test stands in for the neuromuscular channel. */
export type ReadinessTestKind = 'seated_mb_throw' | 'cmj' | 'rsi';

/** The number that test produces, and therefore the unit it is compared in. */
export type ReadinessMetric = 'distance_m' | 'height_in' | 'rsi';

/**
 * The swappable configuration behind channel B, plus the one number channel A
 * needs. Shipped with defaults in `constants.climbing.readiness`, copied onto
 * the athlete so a change never rewrites history.
 */
export interface ReadinessTestConfig {
  kind: ReadinessTestKind;
  metric: ReadinessMetric;
  /** Attempts per test session; the best of them is the day's number. */
  attempts: number;
  /** How many prior test sessions the rolling median is taken over. */
  baselineWindow: number;
  /** More than this percent below the rolling median reads `low`. */
  lowThresholdPct: number;
  /** A Moderate Whoop recovery counts as high unless the score is under this. */
  whoopLowScore: number;
}

/** The two channels, named so a line can say which one moved. */
export type ReadinessChannelName = 'autonomic' | 'neuromuscular';

/** A channel reads high, low, or has no data for the day. */
export type ReadinessBand = 'high' | 'low' | 'unknown';

/** One channel's reading, with the plain words the session shows. */
export interface ReadinessChannel {
  name: ReadinessChannelName;
  /** The raw number behind the band: a recovery score, or the test's best. */
  value?: number;
  band: ReadinessBand;
  /** Second person, no rule number: "Recovery 38%. Data by WHOOP". */
  line: string;
}

/**
 * The four combined states, plus `unknown` for a day with neither channel.
 * Never an average: `autonomic_low` means autonomic low with neuromuscular
 * high, and `neuromuscular_low` the reverse.
 */
export type ReadinessState =
  | 'both_high'
  | 'autonomic_low'
  | 'neuromuscular_low'
  | 'both_low'
  | 'unknown';

/**
 * What a state does to today's session. Every field is downward only: factors
 * are at most 1, `extraReps` adds reps at a lower load (the R27 magnitude),
 * and nothing here may raise a load, a set count, or a contact budget.
 */
export interface ReadinessAdjustment {
  /** Drop power and maximal work one tier. */
  tierDown: boolean;
  /** Hold volume where it is: no extensive-contact raise today. */
  holdVolume: boolean;
  /** Remove maximal jumps, depth jumps included. */
  removeMaximalJumps: boolean;
  /** Multiplier on planned jump volume, 1 for no change. */
  jumpVolumeFactor: number;
  /** Multiplier on prescribed load, 1 for no change. */
  loadFactor: number;
  /** Reps added per set to pay for the lighter load (R27 magnitude). */
  extraReps: number;
  /** Offer to move a recovery day here instead of training. */
  offerRecoverySwap: boolean;
}

/** The gate's whole answer for one day. */
export interface ReadinessOutcome {
  state: ReadinessState;
  /** Fixed order: autonomic first, neuromuscular second. Never averaged. */
  channels: [ReadinessChannel, ReadinessChannel];
  adjustment: ReadinessAdjustment;
  /** The plain-words line the session shows above its blocks. */
  line: string;
  /** The house rule the Plan summary links this to. */
  houseRuleId: string;
}

/** One logged run of the neuromuscular test. */
export interface ReadinessTestSession {
  id: string;
  date: LocalDate;
  kind: ReadinessTestKind;
  /** Every attempt, in order; the config says how many to expect. */
  attempts: number[];
  /** The best attempt, in `unit`. */
  best: number;
  /** Display unit for `best`: "m", "in", or "RSI". */
  unit: string;
}

/**
 * One single-leg jump test: left and right on the same instrument, same day.
 * Never canonical, never a PR (house rule `house.sc.asymmetry_tracking`).
 */
export interface SingleLegTest {
  date: LocalDate;
  instrument: Instrument;
  leftIn: number;
  rightIn: number;
  /** Signed; positive means the left leg jumped higher. */
  asymmetryPct: number;
  /** Null when the two sides are level inside the noise band. */
  weakerSide: Side | null;
}

/**
 * Everything the gate needs for one day, as `materializeWeek` receives it.
 * Absent means the gate does not run and nothing on the session changes, which
 * is what every athlete outside the house rule gets.
 */
export interface ReadinessTodayInput {
  /**
   * The test configuration to score against. Absent falls back to the
   * athlete's own `readinessConfig`, and then to
   * `constants.climbing.readiness`.
   */
  config?: ReadinessTestConfig;
  /** Channel A: that morning's recovery, or null when the day was not scored. */
  whoop?: ReadinessWhoopInput | null;
  /** Channel B: the output test logged today, or null when none was. */
  test?: ReadinessTestSession | null;
  /** Earlier sessions of the same test, any order, for the rolling median. */
  history?: ReadinessTestSession[];
}

/** Channel A's input for one day: the Whoop recovery as it stood that morning. */
export interface ReadinessWhoopInput {
  date: LocalDate;
  /** Recovery score 0 to 100, or null when the day was not scored. */
  score: number | null;
  /** Whoop's own band word, kept verbatim for the line. */
  band: 'low' | 'moderate' | 'high' | null;
}
