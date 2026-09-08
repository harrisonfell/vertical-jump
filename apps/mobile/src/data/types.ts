/**
 * Plain typed objects the repositories return.
 *
 * @vert/engine does not export types.ts yet, so these carry the field names
 * from brief section 12 exactly and keep everything the engine owns (plan
 * skeletons, week plans, per-set prescriptions, snapshots) as opaque JSON.
 * When the engine lands its types, the `Json`-typed fields are the seams to
 * narrow; no column has to move.
 */

import type {
  EntrySource,
  GripMode,
  Instrument,
  Json,
  LocalDate,
  Side,
  Timestamp,
} from './typesPrimitives';

export * from './typesPrimitives';

export type Level = 'beginner' | 'intermediate' | 'advanced';
export type DaysPerWeek = 2 | 3 | 4 | 5;

export type DayType =
  | 'Full Body Strength'
  | 'Lower Strength'
  | 'Upper Strength'
  | 'Upper + Mobility'
  | 'Power + Speed'
  | 'Power'
  | 'Speed'
  | 'Recovery - Mobility';

export type SessionStatus = 'planned' | 'not_finished' | 'done' | 'missed';
export type TestStatus = 'planned' | 'done' | 'deferred' | 'missed';
export type WeekKind = 'load' | 'deload' | 'taper' | 'peak';
export type WeekOutcome = 'progress' | 'small' | 'hold' | 'repeat';
export type Landing = 'good' | 'ok' | 'poor';
export type ScoreState = 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE';
export type PainSeverity = 'none' | 'mild' | 'moderate' | 'severe';

/* --------------------------------------------------------------- athlete */

export interface WorkingMax {
  readonly exerciseId: string;
  readonly valueKg: number;
  readonly source: 'entered' | 'epley' | 'rpe';
  readonly confidence: number;
  readonly frozenAt: Timestamp | null;
  readonly lastRaiseAt: Timestamp | null;
}

export interface Athlete {
  readonly id: string;
  readonly primaryGoal: string | null;
  /**
   * A second goal, when one was named. The climber's is upper_body_power.
   *
   * This and the eight below arrived with migration 5 and are all optional:
   * the store always writes them, but a caller building an athlete literal or
   * a patch has no business spelling nine climbing answers it does not care
   * about. Absent and null both read as "never asked", which is what the
   * bridge gives a default for.
   */
  readonly secondaryGoal?: string | null;
  readonly sport: string | null;
  readonly trainingAgeYears: number | null;
  readonly level: Level | null;
  readonly daysPerWeek: DaysPerWeek | null;
  /** Weekday numbers 0 Sunday to 6 Saturday, in template order. */
  readonly weekdays: readonly number[];
  readonly isAdult: boolean;
  readonly clearance: Json;
  readonly inventory: Json;
  readonly weightRoomAccess: boolean;
  readonly bodyweightKg: number | null;
  readonly workingMax: Readonly<Record<string, WorkingMax>>;
  readonly inSeason: boolean;
  readonly readinessPassedAt: Timestamp | null;
  readonly standingReachMm: number | null;
  readonly goalHeightMm: number | null;
  readonly targetDate: LocalDate | null;
  readonly timezone: string;
  readonly rolloverHour: number;
  readonly testConditionsNote: string | null;
  /** An A2 pulley or other finger-pulley history (`house.sc.open_hand_grip`). */
  readonly fingerHistory?: boolean;
  /** Null reads as 'any', which is what an athlete without that history gets. */
  readonly gripMode?: GripMode | null;
  /** 0 to 10. At or above this, hard finger work comes off the day. */
  readonly fingerPainCeiling?: number | null;
  /** WallWork: `{ weekdays, typicalStart?, typicalEnd? }`, or null. */
  readonly wallWork?: Json;
  /** SessionWindow: `{ start, end }`, or null when the athlete never said. */
  readonly sessionWindow?: Json;
  /** ValgusControl: `{ required, sessionsPerWeek, minHoursFromWall }`. */
  readonly valgusControl?: Json;
  /** The leg that goes first on unilateral work (`house.sc.weaker_side_first`). */
  readonly weakerSide?: Side | null;
  /** ReadinessTestConfig, copied onto the athlete so a swap never rewrites history. */
  readonly readinessConfig?: Json;
  /**
   * `Partial<Record<LiftId, BestSet>>`: the best recent set the athlete typed
   * per lift, `{ reps, loadKg, rpe?, at }`. Absent means none was ever typed.
   */
  readonly bestSets?: Json;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export interface PainStatus {
  readonly id: string;
  readonly athleteId: string;
  readonly location: string;
  readonly severityRaw: number;
  readonly severityDerived: PainSeverity;
  readonly onset: 'acute' | 'chronic';
  readonly durationWeeks: number | null;
  readonly houseRule: boolean;
  readonly note: string | null;
  readonly reportedAt: Timestamp;
  readonly reassessDueAt: LocalDate | null;
  readonly clearedAt: Timestamp | null;
}

/* --------------------------------------------------------------- program */

export interface Program {
  readonly id: string;
  readonly athleteId: string;
  readonly macroIndex: number;
  readonly parentProgramId: string | null;
  readonly rulesetVersion: string;
  readonly seed: string;
  readonly startDate: LocalDate;
  readonly endDate: LocalDate;
  readonly status: 'active' | 'complete' | 'superseded';
  readonly snapshot: Json;
  readonly validationReport: Json;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export interface ProgramVersion {
  readonly id: string;
  readonly programId: string;
  readonly version: number;
  readonly weekLayout: Json;
  readonly reason: string | null;
  readonly createdAt: Timestamp;
}

export interface Block {
  readonly id: string;
  readonly programId: string;
  readonly type: string;
  readonly orderIndex: number;
  readonly weekStart: number;
  readonly weekEnd: number;
}

export interface Week {
  readonly id: string;
  readonly programId: string;
  readonly programVersionId: string | null;
  readonly blockId: string | null;
  readonly w: number;
  readonly windowStart: LocalDate;
  readonly windowEnd: LocalDate;
  readonly kind: WeekKind;
  readonly k: number | null;
  readonly prescribedCount: number;
  readonly completedCount: number;
  readonly adherencePct: number | null;
  readonly allRepsCompleted: boolean | null;
  readonly outcome: WeekOutcome | null;
  readonly generatedAt: Timestamp | null;
  readonly generatedBy: string | null;
  readonly repeatOfWeek: number | null;
  readonly jointHighStressCounts: Json;
  readonly highContactAllowance: number | null;
  readonly extensiveTarget: number | null;
  readonly ladderRungs: Json;
  readonly snapshot: Json;
}

/* --------------------------------------------------------------- session */

export interface Session {
  readonly id: string;
  readonly programId: string;
  readonly weekId: string;
  readonly scheduledDate: LocalDate;
  readonly orderIndex: number;
  readonly dayType: DayType;
  readonly blocksPresent: Json;
  readonly prescribedSetCount: number;
  readonly dismissed: boolean;
  readonly testStatus: TestStatus | null;
  readonly sorenessPre: number | null;
  readonly rpe: number | null;
  readonly legsFeel: string | null;
  readonly notes: string | null;
  readonly isMaximalCns: boolean;
  readonly trimmedExercises: Json;
  readonly appliedModifications: Json;
  readonly shadowModifications: Json;
  readonly snapshot: Json;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

/** A session plus everything derived from its logs. Never a stored stamp. */
export interface SessionWithStatus extends Session {
  readonly status: SessionStatus;
  readonly loggedSetCount: number;
  readonly startedAt: Timestamp | null;
  readonly markedCompleteAt: Timestamp | null;
  readonly whoopWorkoutId: string | null;
}

export interface SessionExercise {
  readonly id: string;
  readonly sessionId: string;
  readonly orderIndex: number;
  readonly exerciseId: string;
  readonly exerciseName: string;
  readonly block: string | null;
  readonly loadType: string;
  readonly loadMode: 'entered' | 'epley' | 'rpe' | 'week1' | 'velocity';
  readonly bothSides: boolean;
  readonly rotationNote: string | null;
  readonly headerNote: string | null;
  readonly lastTimeNote: string | null;
  readonly isNewThisWeek: boolean;
  readonly restS: number | null;
  readonly restRule: string | null;
  /** SetPrescription[] stored verbatim from the engine. */
  readonly perSet: Json;
}

export interface SetLog {
  readonly id: string;
  readonly sessionId: string;
  readonly sessionExerciseId: string;
  readonly setNumber: number;
  readonly repsDone: number | null;
  readonly loadKg: number | null;
  readonly durationS: number | null;
  readonly distanceM: number | null;
  readonly boxHeightMm: number | null;
  readonly landing: Landing | null;
  readonly rpe: number | null;
  /**
   * The leg or arm this set ran on, or null for a set logged once for both.
   * A unilateral row answered per side writes one row per side under the same
   * set number, so the row is still three sets rather than six.
   */
  readonly side: Side | null;
  readonly meanVelocityBest: number | null;
  readonly meanVelocityLast: number | null;
  readonly velocityLossPct: number | null;
  readonly loadSource: string | null;
  readonly entrySource: EntrySource;
  readonly completedAt: Timestamp;
  readonly plannedDate: LocalDate | null;
  readonly offsetDays: number;
  readonly idempotencyKey: string;
  readonly editedAt: Timestamp | null;
  readonly createdAt: Timestamp;
}

export type SessionEventKind = 'start' | 'complete' | 'uncomplete';

export interface SessionEvent {
  readonly id: string;
  readonly sessionId: string;
  readonly kind: SessionEventKind;
  readonly at: Timestamp;
  readonly createdAt: Timestamp;
}

/* ----------------------------------------------------------- instruments */

export interface JumpTestSession {
  readonly id: string;
  readonly athleteId: string;
  readonly sessionId: string | null;
  readonly localDate: LocalDate;
  readonly performedAt: Timestamp;
  readonly instrument: Instrument;
  readonly mode: string;
  readonly unitPreference: string;
  readonly boxHeightMm: number | null;
  readonly deviceFirmware: string | null;
  readonly connectVersion: string | null;
  readonly isBaseline: boolean;
  readonly canonical: boolean;
  readonly scheduled: boolean;
  readonly bodyweightKg: number | null;
  readonly whoopSnapshot: Json;
  readonly notes: string | null;
  readonly importBatchId: string | null;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export interface JumpRep {
  readonly id: string;
  readonly jumpTestSessionId: string;
  readonly attemptIndex: number;
  /** Set on a 'single_leg' test, null on every other mode. */
  readonly side?: Side | null;
  readonly heightMm: number | null;
  readonly gctMs: number | null;
  readonly rsiCalc: number | null;
  readonly rsiDevice: number | null;
  readonly flagged: boolean;
  readonly rejectReason: string | null;
  readonly entrySource: EntrySource;
  readonly importBatchId: string | null;
  readonly createdAt: Timestamp;
}

export interface JumpTestWithReps extends JumpTestSession {
  readonly reps: readonly JumpRep[];
  /** Best unflagged attempt, in millimetres. Null when every rep was flagged. */
  readonly bestHeightMm: number | null;
  /** Best minus worst unflagged attempt. Null with fewer than two attempts. */
  readonly spreadMm: number | null;
  readonly isPr: boolean;
}

/* --------------------------------------------------------- readiness */

export type {
  ReadinessOutcome,
  ReadinessTestSession,
  SessionAnswer,
  SingleLegTest,
} from './typesReadiness';

export interface MetricPr {
  readonly id: string;
  readonly instrument: Instrument;
  readonly mode: string;
  readonly valueMm: number;
  readonly jumpTestSessionId: string;
  readonly localDate: LocalDate;
  readonly thresholdUsedMm: number;
  readonly previousValueMm: number | null;
  readonly computedAt: Timestamp;
}

export interface ImportBatch {
  readonly id: string;
  readonly fileHash: string;
  readonly fileName: string | null;
  readonly type: string;
  readonly exporterVersion: string | null;
  readonly schemaVersion: string | null;
  readonly rowCount: number;
  readonly mapping: Json;
  readonly counts: Json;
  readonly status: 'preview' | 'committed' | 'cancelled';
  readonly createdAt: Timestamp;
  readonly committedAt: Timestamp | null;
}

/* --------------------------------------------------------------- context */

export interface WhoopConnection {
  readonly id: string;
  readonly status: 'disconnected' | 'connecting' | 'connected' | 'revoked' | 'error';
  readonly whoopUserId: string | null;
  readonly scopes: string | null;
  readonly connectedAt: Timestamp | null;
  readonly revokedAt: Timestamp | null;
  readonly lastSyncAt: Timestamp | null;
  readonly backfillCursor: string | null;
  readonly backfillDaysDone: number;
  readonly backfillDaysTotal: number;
  readonly lastError: string | null;
  readonly nextRetryAt: Timestamp | null;
  readonly updatedAt: Timestamp;
}

export interface WhoopRecovery {
  readonly id: string;
  readonly cycleId: string | null;
  readonly sleepId: string | null;
  readonly scoreState: ScoreState;
  readonly userCalibrating: boolean;
  readonly recoveryScore: number | null;
  readonly restingHeartRate: number | null;
  readonly hrvRmssdMilli: number | null;
  readonly spo2Percentage: number | null;
  readonly skinTempCelsius: number | null;
  readonly timezoneOffset: string | null;
  readonly localDate: LocalDate;
  readonly raw: Json;
  readonly updatedAt: Timestamp;
}

export interface WhoopWorkout {
  readonly id: string;
  readonly scoreState: ScoreState;
  readonly sportName: string | null;
  readonly startAt: Timestamp;
  readonly endAt: Timestamp | null;
  readonly timezoneOffset: string | null;
  readonly localDate: LocalDate;
  readonly strain: number | null;
  readonly averageHeartRate: number | null;
  readonly maxHeartRate: number | null;
  readonly percentRecorded: number | null;
  readonly zoneDurations: Json;
  readonly raw: Json;
  readonly updatedAt: Timestamp;
}

export interface SyncOp {
  readonly kind: string;
  readonly entityId?: string;
  readonly payload: Json;
}

export interface SyncQueueRow {
  readonly id: number;
  /**
   * The op's idempotency key, minted once and never reused. Unlike `id`, which
   * is a local autoincrement, it survives a local database reset, so the
   * server cannot mistake a fresh op for one it has already applied.
   */
  readonly uuid: string;
  readonly op: string;
  readonly entityId: string | null;
  readonly payload: Json;
  readonly createdAt: Timestamp;
  readonly attempts: number;
  readonly lastAttemptAt: Timestamp | null;
  readonly lastError: string | null;
}

export interface SyncStatus {
  readonly pending: number;
  readonly oldestPendingAt: Timestamp | null;
  readonly lastSyncedAt: Timestamp | null;
}

export interface AutoregulationStatus {
  readonly id: string;
  readonly athleteId: string;
  readonly enabled: boolean;
  readonly pausedReason: string | null;
  readonly criteria: Json;
  readonly gateMet: boolean;
  readonly evaluatedAt: Timestamp;
}

export interface AthleteBaseline {
  readonly id: string;
  readonly athleteId: string;
  readonly computedFor: LocalDate;
  readonly scoredDays: number;
  readonly logHrvMean: number | null;
  readonly logHrvSd: number | null;
  readonly recoveryP33: number | null;
  readonly recoveryP66: number | null;
  readonly rhrMean: number | null;
  readonly computedAt: Timestamp;
}

export interface ReadinessSignal {
  readonly id: string;
  readonly athleteId: string;
  readonly localDate: LocalDate;
  readonly source: 'rulebook' | 'shadow';
  readonly band: 'green' | 'yellow' | 'red' | null;
  readonly modifier: Json;
  readonly accepted: boolean | null;
  readonly reason: string | null;
  readonly createdAt: Timestamp;
}

/** What the engine's computeAdherence needs, read straight off the store. */
export interface AdherenceInputs {
  readonly weekId: string;
  readonly w: number;
  readonly prescribedCount: number;
  readonly completedCount: number;
  readonly adherencePct: number;
  readonly allRepsCompleted: boolean;
  readonly prescribedSets: number;
  readonly loggedSets: number;
}
