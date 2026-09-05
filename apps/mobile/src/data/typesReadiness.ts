/**
 * The rows the climbing house rules read: the readiness gate's own stream, the
 * gate's answer for one session, the single-leg asymmetry pairs, and the 0 to
 * 10 finger question.
 *
 * Split out of types.ts so that file stays inside its reading length. The
 * import below is type-only and so is erased: there is no module cycle at
 * runtime, and `../types` re-exports everything here, so no caller has to know
 * this file exists.
 */
import type {
  EntrySource,
  Instrument,
  Json,
  LocalDate,
  ReadinessMetric,
  ReadinessState,
  ReadinessTestKind,
  SessionAnswerKind,
  Side,
  Timestamp,
} from './typesPrimitives';

/** One logged run of the neuromuscular test (`house.sc.readiness_gate`). */
export interface ReadinessTestSession {
  readonly id: string;
  readonly athleteId: string;
  readonly localDate: LocalDate;
  readonly kind: ReadinessTestKind;
  readonly metric: ReadinessMetric;
  /** Every attempt, in order. The config says how many to expect. */
  readonly attempts: readonly number[];
  /** The best attempt, in `unit`. Null when nothing usable was logged. */
  readonly best: number | null;
  /** Display unit for `best`: "m", "in", or "RSI". */
  readonly unit: string;
  /** That morning's recovery as it stood, kept so a rescore cannot rewrite it. */
  readonly whoopRecoverySnapshot: Json;
  readonly entrySource: EntrySource;
  readonly createdAt: Timestamp;
}

/** The gate's answer for one session, as it was applied. */
export interface ReadinessOutcome {
  readonly sessionId: string;
  readonly localDate: LocalDate;
  readonly state: ReadinessState;
  /** [autonomic, neuromuscular], in that fixed order. Never averaged. */
  readonly channels: Json;
  readonly adjustment: Json;
  readonly line: string;
  readonly houseRuleId: string | null;
  readonly appliedAt: Timestamp | null;
}

/** One single-leg jump test: left and right, same instrument, same day. */
export interface SingleLegTest {
  readonly id: string;
  readonly localDate: LocalDate;
  readonly instrument: Instrument;
  readonly leftIn: number;
  readonly rightIn: number;
  /** Signed; positive means the left leg jumped higher. */
  readonly asymmetryPct: number;
  /** Null when the two sides are level inside the band. */
  readonly weakerSide: Side | null;
}

/** One question answered before a session, keyed by day. */
export interface SessionAnswer {
  readonly id: string;
  readonly athleteId: string;
  readonly sessionId: string | null;
  readonly localDate: LocalDate;
  readonly kind: SessionAnswerKind;
  readonly value: number | null;
  readonly note: string | null;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}
