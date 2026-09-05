/**
 * What the athlete actually did, and what the engine concludes from it.
 * Adherence is sessions marked complete over sessions scheduled in the
 * calendar week, Recovery days included (brief 09 "Calendar and generation").
 */
import type { ExerciseId, DayType, LandingQuality, LiftId, LoadMode } from './core.js';
import type { IsoInstant, LocalDate } from './calendar.js';

/** One logged set. Every tap writes one of these in a transaction. */
export interface SetLog {
  id: string;
  sessionId: string;
  exerciseId: ExerciseId;
  setNumber: number;
  repsDone?: number;
  loadKg?: number;
  durationS?: number;
  boxHeightIn?: number;
  /** Gates the ladder rule: Good or OK may advance a rung. */
  landing?: LandingQuality;
  /** Logged per set in RPE mode (R74, R158). */
  rpe?: number;
  /** OVR Velocity: best rep's mean velocity, m/s. */
  meanVelocityBest?: number;
  /** OVR Velocity: last rep's mean velocity, m/s. */
  meanVelocityLast?: number;
  /** Percent drop from best to last; hitting the cutoff is a normal completion. */
  velocityLoss?: number;
  loadSource: LoadMode;
  completedAt: IsoInstant;
  /** The date the set was prescribed for, which a retro-log does not change. */
  plannedDate: LocalDate;
  /** UNIQUE in the store; makes the offline queue idempotent. */
  idempotencyKey: string;
}

/** Derived from logs, never stamped (brief section 12 "Derived, never stored"). */
export type SessionStatus = 'planned' | 'done' | 'not_finished' | 'missed' | 'rest';

/** The session-level facts adherence and the outcome read. */
export interface SessionRecord {
  sessionId: string;
  date: LocalDate;
  dayType: DayType;
  status: SessionStatus;
  /** R127: marking complete updates the weekly completion percentage. */
  markedCompleteAt?: IsoInstant;
  /** R27: the 0 to 10 row asked before the session. */
  sorenessPre?: number;
  /** Session RPE; load is session RPE times minutes. */
  rpe?: number;
  /** "Fresh", "Normal", "Heavy" in the Finish sheet. */
  legsFeel?: 'fresh' | 'normal' | 'heavy';
}

/** One week's adherence (R94 to R98). */
export interface Adherence {
  /** Sessions scheduled that week, Recovery days included. */
  prescribed: number;
  /** Sessions marked complete, a moved session counted on its new date. */
  completed: number;
  /** completed / prescribed, 0 to 1. A week with no completed session is 0. */
  pct: number;
  /**
   * Week-level judgement. Unperformed sets in a finished session are
   * "not all reps", not failures.
   */
  allRepsCompleted: boolean;
  /** R97 is judged per lift: true where a prescribed set was logged short. */
  perLiftFailures: Record<LiftId, boolean>;
}

/** R94 to R96 plus the added hold outcome. */
export type WeekOutcome = 'progress' | 'small' | 'hold' | 'repeat';

/** What the outcome changed, with the line the Plan shows. */
export interface OutcomeDecision {
  kind: WeekOutcome;
  /** Change to the progressed-week counter: +1, +0.5, or 0. */
  deltaK: number;
  /** Change to the extensive contact target, in contacts. */
  deltaExtensiveContacts: number;
  /** Change to the R156 starting percent, in percentage points. */
  deltaStartPct: number;
  /** True when the ladder may advance a rung this week (never with +10, R89). */
  allowLadderAdvance: boolean;
  /** R97 drops, as a negative percent per lift. */
  workingMaxDeltaPct: Record<LiftId, number>;
  /** Set when R94 repeats a week. */
  repeatOfWeek?: number;
  /** R131 house: two consecutive weeks under 75% cut the next week 25%. */
  volumeCutPct: number;
  /** Plain words for the Plan, no rule number: "Week 6 at 100%, all reps. Progressed." */
  line: string;
}

/** Whether a session may be moved to another day, and why not. */
export type MoveDecision =
  | { ok: true }
  | {
      /** Plain words: "Can't move Power + Speed here: heavy squat yesterday". */
      ok: false;
      reason: string;
      /** The rule-book number that refused it. */
      rule: number;
    };
