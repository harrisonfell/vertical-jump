/**
 * Whoop v2 objects, and the mirror rows they become.
 *
 * Every object carries `score_state`, and `score` is absent unless the state
 * is SCORED, so every scored field below is nullable and stays null rather
 * than becoming a zero. A cycle, a sleep and a workout each carry their own
 * `timezone_offset`, and the local date is derived from that offset and not
 * from UTC, because Whoop counts physiological cycles rather than calendar
 * days.
 *
 * The v2 Recovery model carries no offset at all: it is `cycle_id, sleep_id,
 * user_id, created_at, updated_at, score_state, score` and nothing more. So a
 * recovery's local date is borrowed from the cycle it belongs to when the
 * mirror is written (see mirrors.ts), and the UTC date below is only the
 * placeholder used until that cycle is known.
 */

import { z } from 'zod';
import type {
  Json,
  WhoopCycleRow,
  WhoopRecoveryRow,
  WhoopSleepRow,
  WhoopWorkoutRow,
} from '../api-contract';

/* -------------------------------------------------------------- schemas */

const scoreState = z.enum(['SCORED', 'PENDING_SCORE', 'UNSCORABLE']);
const id = z.union([z.string(), z.number()]).transform((value) => String(value));

export const cycleV2 = z.object({
  id,
  user_id: z.number().int().optional(),
  start: z.string(),
  end: z.string().nullable().optional(),
  timezone_offset: z.string().nullable().optional(),
  score_state: scoreState,
  score: z
    .object({
      strain: z.number().nullable().optional(),
      kilojoule: z.number().nullable().optional(),
      average_heart_rate: z.number().nullable().optional(),
      max_heart_rate: z.number().nullable().optional(),
    })
    .nullable()
    .optional(),
});
export type CycleV2 = z.infer<typeof cycleV2>;

export const recoveryV2 = z.object({
  cycle_id: id,
  sleep_id: z.string().nullable().optional(),
  user_id: z.number().int().optional(),
  created_at: z.string(),
  updated_at: z.string().optional(),
  score_state: scoreState,
  score: z
    .object({
      user_calibrating: z.boolean().optional(),
      recovery_score: z.number().nullable().optional(),
      resting_heart_rate: z.number().nullable().optional(),
      hrv_rmssd_milli: z.number().nullable().optional(),
      spo2_percentage: z.number().nullable().optional(),
      skin_temp_celsius: z.number().nullable().optional(),
    })
    .nullable()
    .optional(),
});
export type RecoveryV2 = z.infer<typeof recoveryV2>;

export const sleepV2 = z.object({
  id,
  user_id: z.number().int().optional(),
  cycle_id: id.nullable().optional(),
  start: z.string(),
  end: z.string().nullable().optional(),
  timezone_offset: z.string().nullable().optional(),
  nap: z.boolean().optional(),
  score_state: scoreState,
  score: z
    .object({
      sleep_performance_percentage: z.number().nullable().optional(),
      sleep_efficiency_percentage: z.number().nullable().optional(),
      respiratory_rate: z.number().nullable().optional(),
      stage_summary: z
        .object({ total_in_bed_time_milli: z.number().nullable().optional() })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
});
export type SleepV2 = z.infer<typeof sleepV2>;

export const workoutV2 = z.object({
  id,
  user_id: z.number().int().optional(),
  start: z.string(),
  end: z.string().nullable().optional(),
  timezone_offset: z.string().nullable().optional(),
  /** Required in v2; sport_id is deprecated and is not read. */
  sport_name: z.string().nullable().optional(),
  score_state: scoreState,
  score: z
    .object({
      strain: z.number().nullable().optional(),
      average_heart_rate: z.number().nullable().optional(),
      max_heart_rate: z.number().nullable().optional(),
      percent_recorded: z.number().nullable().optional(),
      zone_durations: z.record(z.string(), z.number()).nullable().optional(),
    })
    .nullable()
    .optional(),
});
export type WorkoutV2 = z.infer<typeof workoutV2>;

export const userProfileV2 = z.object({
  user_id: z.number().int(),
  email: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
});

export const bodyMeasurementV2 = z.object({
  height_meter: z.number().nullable().optional(),
  weight_kilogram: z.number().nullable().optional(),
  max_heart_rate: z.number().nullable().optional(),
});

/* ---------------------------------------------------------- local dates */

const OFFSET = /^([+-])(\d{2}):?(\d{2})$/;

/** Minutes east of UTC, or null when the offset is missing or malformed. */
export function offsetMinutes(offset: string | null | undefined): number | null {
  if (offset === null || offset === undefined) return null;
  if (offset === 'Z') return 0;
  const match = OFFSET.exec(offset.trim());
  if (match === null) return null;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/**
 * The record's own local date, "YYYY-MM-DD". With no offset the instant's UTC
 * date is the honest fallback, because inventing a timezone would move a
 * recovery onto the wrong training day.
 */
export function localDateFor(instant: string, offset: string | null | undefined): string {
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) return instant.slice(0, 10);
  const minutes = offsetMinutes(offset) ?? 0;
  return new Date(at.getTime() + minutes * 60_000).toISOString().slice(0, 10);
}

/* -------------------------------------------------------------- mapping */

function raw(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

export function toCycleRow(record: CycleV2, updatedAt: string): WhoopCycleRow {
  const offset = record.timezone_offset ?? null;
  return {
    id: record.id,
    scoreState: record.score_state,
    timezoneOffset: offset,
    localDate: localDateFor(record.start, offset),
    raw: raw(record),
    updatedAt,
    startAt: record.start,
    endAt: record.end ?? null,
    strain: record.score?.strain ?? null,
    averageHeartRate: record.score?.average_heart_rate ?? null,
    kilojoule: record.score?.kilojoule ?? null,
  };
}

/**
 * The recovery mirror row.
 *
 * Keyed on `cycle_id`, which is the natural key of a v2 recovery: keying on
 * `sleep_id ?? cycle_id` mixed two id namespaces, so the same physiological day
 * arriving once without a sleep id and once with one became two rows and the
 * phone was handed two recoveries for one day.
 *
 * `timezoneOffset` stays null here and `localDate` is the UTC placeholder;
 * both are replaced with the cycle's own when the row is written.
 */
export function toRecoveryRow(record: RecoveryV2, updatedAt: string): WhoopRecoveryRow {
  return {
    id: record.cycle_id,
    scoreState: record.score_state,
    timezoneOffset: null,
    localDate: localDateFor(record.created_at, null),
    raw: raw(record),
    updatedAt,
    cycleId: record.cycle_id,
    sleepId: record.sleep_id ?? null,
    // Null, not false: a PENDING_SCORE recovery carries no score object at
    // all, and "not calibrating" is not something anybody knows yet.
    userCalibrating: record.score?.user_calibrating ?? null,
    recoveryScore: record.score?.recovery_score ?? null,
    restingHeartRate: record.score?.resting_heart_rate ?? null,
    hrvRmssdMilli: record.score?.hrv_rmssd_milli ?? null,
    spo2Percentage: record.score?.spo2_percentage ?? null,
    skinTempCelsius: record.score?.skin_temp_celsius ?? null,
  };
}

export function toSleepRow(record: SleepV2, updatedAt: string): WhoopSleepRow {
  const offset = record.timezone_offset ?? null;
  return {
    id: record.id,
    scoreState: record.score_state,
    timezoneOffset: offset,
    localDate: localDateFor(record.start, offset),
    raw: raw(record),
    updatedAt,
    cycleId: record.cycle_id ?? null,
    nap: record.nap ?? false,
    startAt: record.start,
    endAt: record.end ?? null,
    sleepPerformancePercentage: record.score?.sleep_performance_percentage ?? null,
    sleepEfficiencyPercentage: record.score?.sleep_efficiency_percentage ?? null,
    respiratoryRate: record.score?.respiratory_rate ?? null,
    totalInBedTimeMilli: record.score?.stage_summary?.total_in_bed_time_milli ?? null,
  };
}

export function toWorkoutRow(record: WorkoutV2, updatedAt: string): WhoopWorkoutRow {
  const offset = record.timezone_offset ?? null;
  const zones = record.score?.zone_durations ?? null;
  return {
    id: record.id,
    scoreState: record.score_state,
    timezoneOffset: offset,
    localDate: localDateFor(record.start, offset),
    raw: raw(record),
    updatedAt,
    sportName: record.sport_name ?? null,
    startAt: record.start,
    endAt: record.end ?? null,
    strain: record.score?.strain ?? null,
    averageHeartRate: record.score?.average_heart_rate ?? null,
    maxHeartRate: record.score?.max_heart_rate ?? null,
    percentRecorded: record.score?.percent_recorded ?? null,
    zoneDurations: zones === null ? null : raw(zones),
  };
}
