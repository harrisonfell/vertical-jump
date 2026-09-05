import type { SqlExecutor } from '../executor';
import type { Json, LocalDate, ScoreState, Timestamp } from '../types';
import { intBool, nowIso, toJson, toJsonRequired } from './rows';

/**
 * The four Whoop mirrors, written the only way a webhook allows: as upserts.
 *
 * Creates arrive as "updated" events, deliveries repeat, and a record can be
 * rescored after the fact, so every write replaces the row for that Whoop id
 * and carries the raw JSON along with the fields we read.
 */

/* -------------------------------------------------------------- mirrors */

export interface WhoopMirrorBase {
  readonly id: string;
  readonly scoreState: ScoreState;
  readonly timezoneOffset?: string | null;
  readonly localDate: LocalDate;
  readonly raw: Json;
}

export interface WhoopCycleInput extends WhoopMirrorBase {
  readonly startAt: Timestamp;
  readonly endAt?: Timestamp | null;
  readonly strain?: number | null;
  readonly averageHeartRate?: number | null;
  readonly kilojoule?: number | null;
}

export interface WhoopRecoveryInput extends WhoopMirrorBase {
  readonly cycleId?: string | null;
  readonly sleepId?: string | null;
  readonly userCalibrating?: boolean;
  readonly recoveryScore?: number | null;
  readonly restingHeartRate?: number | null;
  readonly hrvRmssdMilli?: number | null;
  readonly spo2Percentage?: number | null;
  readonly skinTempCelsius?: number | null;
}

export interface WhoopSleepInput extends WhoopMirrorBase {
  readonly cycleId?: string | null;
  readonly nap?: boolean;
  readonly startAt: Timestamp;
  readonly endAt?: Timestamp | null;
  readonly sleepPerformancePercentage?: number | null;
  readonly sleepEfficiencyPercentage?: number | null;
  readonly respiratoryRate?: number | null;
  readonly totalInBedTimeMilli?: number | null;
}

export interface WhoopWorkoutInput extends WhoopMirrorBase {
  readonly sportName?: string | null;
  readonly startAt: Timestamp;
  readonly endAt?: Timestamp | null;
  readonly strain?: number | null;
  readonly averageHeartRate?: number | null;
  readonly maxHeartRate?: number | null;
  readonly percentRecorded?: number | null;
  readonly zoneDurations?: Json;
}

/** Creates arrive as "updated" webhooks, so every mirror write is an upsert. */
export async function upsertWhoopCycle(db: SqlExecutor, input: WhoopCycleInput): Promise<void> {
  await db.runAsync(
    `INSERT INTO whoop_cycle
       (id, score_state, start_at, end_at, timezone_offset, local_date, strain,
        average_heart_rate, kilojoule, raw, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       score_state = excluded.score_state, start_at = excluded.start_at, end_at = excluded.end_at,
       timezone_offset = excluded.timezone_offset, local_date = excluded.local_date,
       strain = excluded.strain, average_heart_rate = excluded.average_heart_rate,
       kilojoule = excluded.kilojoule, raw = excluded.raw, updated_at = excluded.updated_at`,
    [
      input.id,
      input.scoreState,
      input.startAt,
      input.endAt ?? null,
      input.timezoneOffset ?? null,
      input.localDate,
      input.strain ?? null,
      input.averageHeartRate ?? null,
      input.kilojoule ?? null,
      toJsonRequired(input.raw),
      nowIso(),
    ],
  );
}

export async function upsertWhoopRecovery(db: SqlExecutor, input: WhoopRecoveryInput): Promise<void> {
  await db.runAsync(
    `INSERT INTO whoop_recovery
       (id, cycle_id, sleep_id, score_state, user_calibrating, recovery_score, resting_heart_rate,
        hrv_rmssd_milli, spo2_percentage, skin_temp_celsius, timezone_offset, local_date, raw, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       cycle_id = excluded.cycle_id, sleep_id = excluded.sleep_id,
       score_state = excluded.score_state, user_calibrating = excluded.user_calibrating,
       recovery_score = excluded.recovery_score, resting_heart_rate = excluded.resting_heart_rate,
       hrv_rmssd_milli = excluded.hrv_rmssd_milli, spo2_percentage = excluded.spo2_percentage,
       skin_temp_celsius = excluded.skin_temp_celsius, timezone_offset = excluded.timezone_offset,
       local_date = excluded.local_date, raw = excluded.raw, updated_at = excluded.updated_at`,
    [
      input.id,
      input.cycleId ?? null,
      input.sleepId ?? null,
      input.scoreState,
      intBool(input.userCalibrating ?? false),
      input.recoveryScore ?? null,
      input.restingHeartRate ?? null,
      input.hrvRmssdMilli ?? null,
      input.spo2Percentage ?? null,
      input.skinTempCelsius ?? null,
      input.timezoneOffset ?? null,
      input.localDate,
      toJsonRequired(input.raw),
      nowIso(),
    ],
  );
}

export async function upsertWhoopSleep(db: SqlExecutor, input: WhoopSleepInput): Promise<void> {
  await db.runAsync(
    `INSERT INTO whoop_sleep
       (id, cycle_id, score_state, nap, start_at, end_at, timezone_offset, local_date,
        sleep_performance_percentage, sleep_efficiency_percentage, respiratory_rate,
        total_in_bed_time_milli, raw, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       cycle_id = excluded.cycle_id, score_state = excluded.score_state, nap = excluded.nap,
       start_at = excluded.start_at, end_at = excluded.end_at,
       timezone_offset = excluded.timezone_offset, local_date = excluded.local_date,
       sleep_performance_percentage = excluded.sleep_performance_percentage,
       sleep_efficiency_percentage = excluded.sleep_efficiency_percentage,
       respiratory_rate = excluded.respiratory_rate,
       total_in_bed_time_milli = excluded.total_in_bed_time_milli,
       raw = excluded.raw, updated_at = excluded.updated_at`,
    [
      input.id,
      input.cycleId ?? null,
      input.scoreState,
      intBool(input.nap ?? false),
      input.startAt,
      input.endAt ?? null,
      input.timezoneOffset ?? null,
      input.localDate,
      input.sleepPerformancePercentage ?? null,
      input.sleepEfficiencyPercentage ?? null,
      input.respiratoryRate ?? null,
      input.totalInBedTimeMilli ?? null,
      toJsonRequired(input.raw),
      nowIso(),
    ],
  );
}

export async function upsertWhoopWorkout(db: SqlExecutor, input: WhoopWorkoutInput): Promise<void> {
  await db.runAsync(
    `INSERT INTO whoop_workout
       (id, score_state, sport_name, start_at, end_at, timezone_offset, local_date, strain,
        average_heart_rate, max_heart_rate, percent_recorded, zone_durations, raw, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       score_state = excluded.score_state, sport_name = excluded.sport_name,
       start_at = excluded.start_at, end_at = excluded.end_at,
       timezone_offset = excluded.timezone_offset, local_date = excluded.local_date,
       strain = excluded.strain, average_heart_rate = excluded.average_heart_rate,
       max_heart_rate = excluded.max_heart_rate, percent_recorded = excluded.percent_recorded,
       zone_durations = excluded.zone_durations, raw = excluded.raw, updated_at = excluded.updated_at`,
    [
      input.id,
      input.scoreState,
      input.sportName ?? null,
      input.startAt,
      input.endAt ?? null,
      input.timezoneOffset ?? null,
      input.localDate,
      input.strain ?? null,
      input.averageHeartRate ?? null,
      input.maxHeartRate ?? null,
      input.percentRecorded ?? null,
      toJson(input.zoneDurations),
      toJsonRequired(input.raw),
      nowIso(),
    ],
  );
}

export async function deleteWhoopWorkout(db: SqlExecutor, workoutId: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM session_workout_link WHERE whoop_workout_id = ?', [workoutId]);
    await db.runAsync('DELETE FROM whoop_workout WHERE id = ?', [workoutId]);
  });
}
