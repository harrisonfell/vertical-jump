/**
 * The scalar types every row type is built from, on their own so that the two
 * files that need them, `types.ts` and `typesReadiness.ts`, can both import
 * from here rather than from each other. Everything is re-exported from
 * `../types`, so no caller has to know this file exists.
 */

export type Json = unknown;

/** "YYYY-MM-DD" in the athlete's zone. See src/lib/localDay.ts. */
export type LocalDate = string;
/** ISO 8601 instant. */
export type Timestamp = string;

export type EntrySource = 'typed' | 'imported' | 'estimated';
export type Instrument = 'ovr_jump_regular' | 'ovr_jump_rsi' | 'vertec_reach_touch' | 'manual';

/* ------------------------------------------------ the climbing unions */

/** House `house.sc.open_hand_grip`: the grip every pulling row is shown in. */
export type GripMode = 'open_hand' | 'half_crimp' | 'full_crimp' | 'any';

export type Side = 'left' | 'right';

/** House `house.sc.readiness_gate`: the swappable neuromuscular test. */
export type ReadinessTestKind = 'seated_mb_throw' | 'cmj' | 'rsi';

/** The number that test produces, and so the unit it is compared in. */
export type ReadinessMetric = 'distance_m' | 'height_in' | 'rsi';

/**
 * The four combined states, plus `unknown` for a day with neither channel.
 * Never an average: `autonomic_low` is autonomic low with neuromuscular high.
 */
export type ReadinessState =
  | 'both_high'
  | 'autonomic_low'
  | 'neuromuscular_low'
  | 'both_low'
  | 'unknown';

/** The only session answer kind so far: the 0 to 10 finger-pain question. */
export type SessionAnswerKind = 'finger_pain';
