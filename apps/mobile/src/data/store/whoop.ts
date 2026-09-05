import type { SqlExecutor } from '../executor';
import type {
  LocalDate,
  ScoreState,
  Timestamp,
  WhoopConnection,
  WhoopRecovery,
  WhoopWorkout,
} from '../types';
import { bool, fromJson, nowIso, oneOf } from './rows';

/**
 * Whoop mirrors. Every row keeps the raw JSON beside the fields we read, so a
 * schema surprise is a re-parse rather than a re-sync, and every row carries
 * its own score_state because a score is absent unless it is SCORED. Local
 * dates come from each record's own timezone offset: Whoop counts
 * physiological cycles, not calendar days.
 */

/** The mirror writes live next door; this is their front door. */
export {
  deleteWhoopWorkout,
  upsertWhoopCycle,
  upsertWhoopRecovery,
  upsertWhoopSleep,
  upsertWhoopWorkout,
  type WhoopCycleInput,
  type WhoopMirrorBase,
  type WhoopRecoveryInput,
  type WhoopSleepInput,
  type WhoopWorkoutInput,
} from './whoopMirrors';

export const WHOOP_CONNECTION_ID = 'whoop_owner';

const SCORE_STATES: readonly ScoreState[] = ['SCORED', 'PENDING_SCORE', 'UNSCORABLE'];
const STATUSES = ['disconnected', 'connecting', 'connected', 'revoked', 'error'] as const;

interface ConnectionRow {
  readonly id: string;
  readonly status: string;
  readonly whoop_user_id: string | null;
  readonly scopes: string | null;
  readonly connected_at: string | null;
  readonly revoked_at: string | null;
  readonly last_sync_at: string | null;
  readonly backfill_cursor: string | null;
  readonly backfill_days_done: number;
  readonly backfill_days_total: number;
  readonly last_error: string | null;
  readonly next_retry_at: string | null;
  readonly updated_at: string;
}

interface RecoveryRow {
  readonly id: string;
  readonly cycle_id: string | null;
  readonly sleep_id: string | null;
  readonly score_state: string;
  readonly user_calibrating: number;
  readonly recovery_score: number | null;
  readonly resting_heart_rate: number | null;
  readonly hrv_rmssd_milli: number | null;
  readonly spo2_percentage: number | null;
  readonly skin_temp_celsius: number | null;
  readonly timezone_offset: string | null;
  readonly local_date: string;
  readonly raw: string;
  readonly updated_at: string;
}

interface WorkoutRow {
  readonly id: string;
  readonly score_state: string;
  readonly sport_name: string | null;
  readonly start_at: string;
  readonly end_at: string | null;
  readonly timezone_offset: string | null;
  readonly local_date: string;
  readonly strain: number | null;
  readonly average_heart_rate: number | null;
  readonly max_heart_rate: number | null;
  readonly percent_recorded: number | null;
  readonly zone_durations: string | null;
  readonly raw: string;
  readonly updated_at: string;
}

function mapConnection(row: ConnectionRow): WhoopConnection {
  return {
    id: row.id,
    status: oneOf(row.status, STATUSES, 'disconnected'),
    whoopUserId: row.whoop_user_id,
    scopes: row.scopes,
    connectedAt: row.connected_at,
    revokedAt: row.revoked_at,
    lastSyncAt: row.last_sync_at,
    backfillCursor: row.backfill_cursor,
    backfillDaysDone: row.backfill_days_done,
    backfillDaysTotal: row.backfill_days_total,
    lastError: row.last_error,
    nextRetryAt: row.next_retry_at,
    updatedAt: row.updated_at,
  };
}

function mapRecovery(row: RecoveryRow): WhoopRecovery {
  return {
    id: row.id,
    cycleId: row.cycle_id,
    sleepId: row.sleep_id,
    scoreState: oneOf(row.score_state, SCORE_STATES, 'PENDING_SCORE'),
    userCalibrating: bool(row.user_calibrating),
    recoveryScore: row.recovery_score,
    restingHeartRate: row.resting_heart_rate,
    hrvRmssdMilli: row.hrv_rmssd_milli,
    spo2Percentage: row.spo2_percentage,
    skinTempCelsius: row.skin_temp_celsius,
    timezoneOffset: row.timezone_offset,
    localDate: row.local_date,
    raw: fromJson(row.raw),
    updatedAt: row.updated_at,
  };
}

function mapWorkout(row: WorkoutRow): WhoopWorkout {
  return {
    id: row.id,
    scoreState: oneOf(row.score_state, SCORE_STATES, 'PENDING_SCORE'),
    sportName: row.sport_name,
    startAt: row.start_at,
    endAt: row.end_at,
    timezoneOffset: row.timezone_offset,
    localDate: row.local_date,
    strain: row.strain,
    averageHeartRate: row.average_heart_rate,
    maxHeartRate: row.max_heart_rate,
    percentRecorded: row.percent_recorded,
    zoneDurations: fromJson(row.zone_durations),
    raw: fromJson(row.raw),
    updatedAt: row.updated_at,
  };
}

/* ----------------------------------------------------------- connection */

export type WhoopConnectionPatch = Partial<Omit<WhoopConnection, 'id' | 'updatedAt'>>;

export async function getWhoopConnection(db: SqlExecutor): Promise<WhoopConnection> {
  const row = await db.getFirstAsync<ConnectionRow>('SELECT * FROM whoop_connection WHERE id = ?', [
    WHOOP_CONNECTION_ID,
  ]);
  if (row !== null) return mapConnection(row);
  const at = nowIso();
  return {
    id: WHOOP_CONNECTION_ID,
    status: 'disconnected',
    whoopUserId: null,
    scopes: null,
    connectedAt: null,
    revokedAt: null,
    lastSyncAt: null,
    backfillCursor: null,
    backfillDaysDone: 0,
    backfillDaysTotal: 0,
    lastError: null,
    nextRetryAt: null,
    updatedAt: at,
  };
}

export async function setWhoopConnection(
  db: SqlExecutor,
  patch: WhoopConnectionPatch,
): Promise<WhoopConnection> {
  const current = await getWhoopConnection(db);
  const next = { ...current, ...patch };
  await db.runAsync(
    `INSERT INTO whoop_connection
       (id, status, whoop_user_id, scopes, connected_at, revoked_at, last_sync_at,
        backfill_cursor, backfill_days_done, backfill_days_total, last_error, next_retry_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       whoop_user_id = excluded.whoop_user_id,
       scopes = excluded.scopes,
       connected_at = excluded.connected_at,
       revoked_at = excluded.revoked_at,
       last_sync_at = excluded.last_sync_at,
       backfill_cursor = excluded.backfill_cursor,
       backfill_days_done = excluded.backfill_days_done,
       backfill_days_total = excluded.backfill_days_total,
       last_error = excluded.last_error,
       next_retry_at = excluded.next_retry_at,
       updated_at = excluded.updated_at`,
    [
      WHOOP_CONNECTION_ID,
      next.status,
      next.whoopUserId,
      next.scopes,
      next.connectedAt,
      next.revokedAt,
      next.lastSyncAt,
      next.backfillCursor,
      next.backfillDaysDone,
      next.backfillDaysTotal,
      next.lastError,
      next.nextRetryAt,
      nowIso(),
    ],
  );
  return getWhoopConnection(db);
}

/* -------------------------------------------------------------- reading */

/** Recovery for a date range, inclusive. Missing days are gaps, never zeros. */
export async function listRecovery(
  db: SqlExecutor,
  from: LocalDate,
  to: LocalDate,
): Promise<WhoopRecovery[]> {
  const rows = await db.getAllAsync<RecoveryRow>(
    'SELECT * FROM whoop_recovery WHERE local_date >= ? AND local_date <= ? ORDER BY local_date',
    [from, to],
  );
  return rows.map(mapRecovery);
}

export async function getRecoveryForDay(
  db: SqlExecutor,
  day: LocalDate,
): Promise<WhoopRecovery | null> {
  const row = await db.getFirstAsync<RecoveryRow>(
    'SELECT * FROM whoop_recovery WHERE local_date = ? ORDER BY updated_at DESC LIMIT 1',
    [day],
  );
  return row === null ? null : mapRecovery(row);
}

/** Scored, non-calibrating days: the denominator the autoregulation gate counts. */
export async function countScoredRecoveryDays(db: SqlExecutor): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM whoop_recovery WHERE score_state = 'SCORED' AND user_calibrating = 0",
  );
  return row?.n ?? 0;
}

export async function listWorkoutsBetween(
  db: SqlExecutor,
  fromIso: Timestamp,
  toIso: Timestamp,
): Promise<WhoopWorkout[]> {
  const rows = await db.getAllAsync<WorkoutRow>(
    'SELECT * FROM whoop_workout WHERE start_at >= ? AND start_at <= ? ORDER BY start_at',
    [fromIso, toIso],
  );
  return rows.map(mapWorkout);
}

export async function getWorkout(db: SqlExecutor, workoutId: string): Promise<WhoopWorkout | null> {
  const row = await db.getFirstAsync<WorkoutRow>('SELECT * FROM whoop_workout WHERE id = ?', [
    workoutId,
  ]);
  return row === null ? null : mapWorkout(row);
}

/* ----------------------------------------------------------------- link */

export interface SessionWorkoutLink {
  readonly sessionId: string;
  readonly whoopWorkoutId: string;
  readonly matchSource: 'auto' | 'manual';
  readonly overlapS: number;
  readonly linkedAt: Timestamp;
}

export async function linkWorkout(
  db: SqlExecutor,
  sessionId: string,
  whoopWorkoutId: string,
  matchSource: 'auto' | 'manual',
  overlapS: number,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO session_workout_link (session_id, whoop_workout_id, match_source, overlap_s, linked_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       whoop_workout_id = excluded.whoop_workout_id,
       match_source = excluded.match_source,
       overlap_s = excluded.overlap_s,
       linked_at = excluded.linked_at`,
    [sessionId, whoopWorkoutId, matchSource, Math.round(overlapS), nowIso()],
  );
}

export async function unlinkWorkout(db: SqlExecutor, sessionId: string): Promise<void> {
  await db.runAsync('DELETE FROM session_workout_link WHERE session_id = ?', [sessionId]);
}

export async function getSessionLink(
  db: SqlExecutor,
  sessionId: string,
): Promise<SessionWorkoutLink | null> {
  const row = await db.getFirstAsync<{
    session_id: string;
    whoop_workout_id: string;
    match_source: string;
    overlap_s: number;
    linked_at: string;
  }>('SELECT * FROM session_workout_link WHERE session_id = ?', [sessionId]);
  if (row === null) return null;
  return {
    sessionId: row.session_id,
    whoopWorkoutId: row.whoop_workout_id,
    matchSource: row.match_source === 'manual' ? 'manual' : 'auto',
    overlapS: row.overlap_s,
    linkedAt: row.linked_at,
  };
}

/* ------------------------------------------------------------- webhooks */

/**
 * Whoop retries a webhook five times over an hour, so the trace id is the
 * dedupe key: the second delivery of the same trace is a no-op.
 */
export async function recordWebhook(
  db: SqlExecutor,
  traceId: string,
  type: string,
  entityId: string | null,
): Promise<boolean> {
  const result = await db.runAsync(
    `INSERT INTO webhook_event (trace_id, type, entity_id, received_at)
     VALUES (?, ?, ?, ?) ON CONFLICT(trace_id) DO NOTHING`,
    [traceId, type, entityId, nowIso()],
  );
  return result.changes > 0;
}

export async function markWebhookProcessed(db: SqlExecutor, traceId: string): Promise<void> {
  await db.runAsync('UPDATE webhook_event SET processed_at = ? WHERE trace_id = ?', [
    nowIso(),
    traceId,
  ]);
}
