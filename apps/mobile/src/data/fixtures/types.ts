import type {
  DayType,
  EntrySource,
  GripMode,
  Instrument,
  Json,
  Landing,
  LocalDate,
  ReadinessMetric,
  ReadinessTestKind,
  ScoreState,
  Side,
  Timestamp,
  WeekKind,
} from '../types';

/**
 * The shape a fixture hands the store.
 *
 * Sessions and exercises carry a `key` instead of an id so a fixture can be
 * written by hand; the seeder maps keys to the ids it generates. When
 * @vert/engine exports buildOwnerFixture, it only has to produce this shape.
 */

export interface FixtureAthlete {
  readonly primaryGoal?: string;
  readonly secondaryGoal?: string;
  readonly sport?: string;
  readonly trainingAgeYears?: number;
  readonly level?: 'beginner' | 'intermediate' | 'advanced';
  readonly daysPerWeek?: 2 | 3 | 4 | 5;
  readonly weekdays?: readonly number[];
  readonly inventory?: Json;
  readonly clearance?: Json;
  readonly weightRoomAccess?: boolean;
  readonly bodyweightKg?: number;
  readonly goalHeightMm?: number;
  readonly targetDate?: LocalDate;
  readonly standingReachMm?: number;
  readonly timezone: string;
  readonly rolloverHour?: number;
  readonly inSeason?: boolean;
  readonly workingMax?: Json;
  /* The climbing answers (`house.sc.*`). Absent means the question was never
   * asked, which is what every non-climbing fixture looks like. */
  readonly fingerHistory?: boolean;
  readonly gripMode?: GripMode;
  readonly fingerPainCeiling?: number;
  readonly wallWork?: Json;
  readonly sessionWindow?: Json;
  readonly valgusControl?: Json;
  readonly weakerSide?: Side | null;
  readonly readinessConfig?: Json;
  /** `{ box_squat: { reps, loadKg, rpe?, at } }`, the best recent set per lift. */
  readonly bestSets?: Json;
}

export interface FixtureExercise {
  readonly key: string;
  readonly exerciseId: string;
  readonly exerciseName: string;
  readonly orderIndex: number;
  readonly loadType: string;
  readonly loadMode?: 'entered' | 'epley' | 'rpe' | 'week1' | 'velocity';
  readonly block?: string;
  readonly bothSides?: boolean;
  readonly headerNote?: string;
  readonly lastTimeNote?: string;
  readonly rotationNote?: string;
  readonly isNewThisWeek?: boolean;
  readonly restS?: number;
  readonly restRule?: string;
  readonly perSet: Json;
}

export interface FixtureSession {
  readonly key: string;
  readonly weekW: number;
  readonly scheduledDate: LocalDate;
  readonly orderIndex: number;
  readonly dayType: DayType;
  readonly testStatus?: 'planned' | 'done' | 'deferred' | 'missed';
  readonly isMaximalCns?: boolean;
  readonly sorenessPre?: number;
  readonly rpe?: number;
  readonly legsFeel?: string;
  readonly notes?: string;
  readonly markedCompleteAt?: Timestamp;
  readonly blocksPresent?: Json;
  readonly trimmedExercises?: Json;
  /** The engine's SessionPlan, stored verbatim, for everything a column drops. */
  readonly snapshot?: Json;
  readonly exercises: readonly FixtureExercise[];
}

export interface FixtureSetLog {
  readonly sessionKey: string;
  readonly exerciseKey: string;
  readonly setNumber: number;
  readonly repsDone?: number;
  readonly loadKg?: number;
  readonly durationS?: number;
  readonly distanceM?: number;
  readonly rpe?: number;
  readonly landing?: Landing;
  readonly completedAt: Timestamp;
  readonly plannedDate?: LocalDate;
  readonly entrySource?: EntrySource;
}

export interface FixtureWeek {
  readonly w: number;
  readonly windowStart: LocalDate;
  readonly windowEnd: LocalDate;
  readonly kind: WeekKind;
  readonly k?: number;
  readonly prescribedCount?: number;
  readonly extensiveTarget?: number;
  readonly highContactAllowance?: number;
  readonly ladderRungs?: Json;
  readonly repeatOfWeek?: number;
  /** The engine's WeekPlan, stored verbatim. */
  readonly snapshot?: Json;
}

export interface FixtureProgram {
  readonly rulesetVersion: string;
  readonly seed: string;
  readonly startDate: LocalDate;
  readonly endDate: LocalDate;
  readonly snapshot: Json;
  readonly weekLayout: Json;
  readonly blocks: readonly {
    readonly type: string;
    readonly orderIndex: number;
    readonly weekStart: number;
    readonly weekEnd: number;
  }[];
}

export interface FixtureJumpAttempt {
  readonly attemptIndex: number;
  readonly heightMm: number;
  readonly gctMs?: number;
  /** Set on a single-leg test, absent on every other mode. */
  readonly side?: Side;
  readonly flagged?: boolean;
}

/** One logged run of the gate's neuromuscular test (`house.sc.readiness_gate`). */
export interface FixtureReadinessTest {
  readonly localDate: LocalDate;
  readonly kind: ReadinessTestKind;
  readonly metric: ReadinessMetric;
  readonly attempts: readonly number[];
  readonly best: number;
  readonly unit: string;
  readonly createdAt?: Timestamp;
  readonly whoopRecoverySnapshot?: Json;
}

export interface FixtureJumpTest {
  readonly localDate: LocalDate;
  readonly performedAt: Timestamp;
  readonly instrument: Instrument;
  readonly mode?: string;
  readonly isBaseline?: boolean;
  readonly canonical?: boolean;
  readonly bodyweightKg?: number;
  readonly notes?: string;
  readonly attempts: readonly FixtureJumpAttempt[];
}

export interface FixtureWhoopRecovery {
  readonly id: string;
  readonly localDate: LocalDate;
  readonly scoreState: ScoreState;
  readonly userCalibrating?: boolean;
  readonly recoveryScore?: number;
  readonly restingHeartRate?: number;
  readonly hrvRmssdMilli?: number;
  readonly raw: Json;
}

export interface FixtureWhoopSleep {
  readonly id: string;
  readonly localDate: LocalDate;
  readonly scoreState: ScoreState;
  readonly startAt: Timestamp;
  readonly endAt: Timestamp;
  readonly sleepPerformancePercentage?: number;
  /** Whoop's own time in bed. The strip reads it as "Sleep 7.2 h". */
  readonly totalInBedTimeMilli?: number;
  readonly raw: Json;
}

export interface FixtureWhoopCycle {
  readonly id: string;
  readonly localDate: LocalDate;
  readonly scoreState: ScoreState;
  readonly startAt: Timestamp;
  readonly endAt?: Timestamp;
  readonly strain?: number;
  readonly raw: Json;
}

export interface FixtureWhoopWorkout {
  readonly id: string;
  readonly localDate: LocalDate;
  readonly scoreState: ScoreState;
  readonly sportName?: string;
  readonly startAt: Timestamp;
  readonly endAt?: Timestamp;
  readonly strain?: number;
  readonly averageHeartRate?: number;
  readonly maxHeartRate?: number;
  readonly raw: Json;
}

/**
 * The Whoop connection row the fixture seeds.
 *
 * Without it the strip reads "Whoop not connected" over ninety days of seeded
 * mirrors: the strip's model asks the connection first, and mirrors with no
 * connection behind them are data the app is right to refuse to show.
 */
export interface FixtureWhoopConnection {
  readonly status: 'disconnected' | 'connecting' | 'connected' | 'revoked' | 'error';
  readonly connectedAt: Timestamp;
  readonly lastSyncAt: Timestamp;
  readonly whoopUserId?: string;
  readonly scopes?: string;
  readonly backfillDaysDone?: number;
  readonly backfillDaysTotal?: number;
}

export interface FixtureData {
  readonly athlete: FixtureAthlete;
  readonly program: FixtureProgram;
  readonly weeks: readonly FixtureWeek[];
  readonly sessions: readonly FixtureSession[];
  readonly setLogs: readonly FixtureSetLog[];
  readonly jumpTests: readonly FixtureJumpTest[];
  /** The gate's own stream. Absent on a fixture whose sport has no gate. */
  readonly readinessTests?: readonly FixtureReadinessTest[];
  readonly whoopConnection?: FixtureWhoopConnection;
  readonly whoopCycles?: readonly FixtureWhoopCycle[];
  readonly whoopRecoveries?: readonly FixtureWhoopRecovery[];
  readonly whoopSleeps?: readonly FixtureWhoopSleep[];
  readonly whoopWorkouts?: readonly FixtureWhoopWorkout[];
  readonly kv?: Readonly<Record<string, string>>;
}

/** Structural check for anything handed to us by another package. */
export function isFixtureData(value: unknown): value is FixtureData {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Partial<FixtureData>;
  return (
    typeof candidate.athlete === 'object' &&
    candidate.athlete !== null &&
    typeof candidate.program === 'object' &&
    candidate.program !== null &&
    Array.isArray(candidate.weeks) &&
    Array.isArray(candidate.sessions) &&
    Array.isArray(candidate.setLogs) &&
    Array.isArray(candidate.jumpTests)
  );
}
