/**
 * The Whoop mirror rows the fixture ships, as plain data.
 *
 * Shapes follow the Whoop v2 API objects the app mirrors (brief section 11 and
 * section 12 `whoop_cycle`, `whoop_recovery`, `whoop_sleep`, `whoop_workout`).
 * Whoop's own vocabulary is kept unchanged, `score_state` included: a day can
 * be SCORED, PENDING_SCORE or UNSCORABLE, and the app must render all three.
 *
 * Everything here is generated from the seeded PRNG, so two runs are
 * byte-identical and screenshots do not drift.
 */
import { addDays } from '../calendar.js';
import type { Prng } from '../prng.js';
import type { LocalDate } from '../types/calendar.js';

/** Whoop's own scoring states, unchanged. */
export type WhoopScoreState = 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE';

/** One physiological cycle (`whoop_cycle`). */
export interface WhoopCycleRow {
  id: number;
  localDay: LocalDate;
  start: string;
  end: string;
  timezone_offset: string;
  score_state: WhoopScoreState;
  score?: {
    strain: number;
    kilojoule: number;
    average_heart_rate: number;
    max_heart_rate: number;
  };
}

/** One recovery score (`whoop_recovery`). */
export interface WhoopRecoveryRow {
  cycle_id: number;
  sleep_id: number;
  localDay: LocalDate;
  score_state: WhoopScoreState;
  score?: {
    user_calibrating: boolean;
    recovery_score: number;
    resting_heart_rate: number;
    hrv_rmssd_milli: number;
    spo2_percentage: number;
    skin_temp_celsius: number;
  };
}

/** One sleep (`whoop_sleep`). */
export interface WhoopSleepRow {
  id: number;
  localDay: LocalDate;
  start: string;
  end: string;
  nap: boolean;
  score_state: WhoopScoreState;
  score?: {
    sleep_performance_percentage: number;
    sleep_consistency_percentage: number;
    sleep_efficiency_percentage: number;
    total_in_bed_time_milli: number;
    total_slow_wave_sleep_time_milli: number;
    total_rem_sleep_time_milli: number;
  };
}

/** One workout (`whoop_workout`). */
export interface WhoopWorkoutRow {
  id: number;
  localDay: LocalDate;
  start: string;
  end: string;
  sport_id: number;
  score_state: WhoopScoreState;
  score?: {
    strain: number;
    average_heart_rate: number;
    max_heart_rate: number;
    kilojoule: number;
  };
}

/** Ninety days of mirrors, one bucket per table. */
export interface WhoopMirror {
  cycles: WhoopCycleRow[];
  recoveries: WhoopRecoveryRow[];
  sleeps: WhoopSleepRow[];
  workouts: WhoopWorkoutRow[];
}

/** Whoop's weightlifting sport id, which the session link matches on. */
export const WHOOP_SPORT_WEIGHTLIFTING = 45;

function instant(day: LocalDate, hour: number, minute = 0): string {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return `${day}T${hh}:${mm}:00.000Z`;
}

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * `PENDING_SCORE` on the two most recent days that carried a workout, and
 * `UNSCORABLE` on two days the strap was off: the app has to render both
 * without inventing a number.
 */
function stateFor(index: number, total: number, trainingDay: boolean): WhoopScoreState {
  if (index === total - 1 && trainingDay) return 'PENDING_SCORE';
  if (index === total - 8) return 'PENDING_SCORE';
  if (index === total - 30 || index === total - 61) return 'UNSCORABLE';
  return 'SCORED';
}

/**
 * Ninety days of mirrors ending on `lastDay`, with a workout on every training
 * date. Deterministic: every value comes from `prng`.
 */
export function buildWhoopMirror(
  lastDay: LocalDate,
  trainingDates: ReadonlySet<LocalDate>,
  prng: Prng,
  days = 90,
): WhoopMirror {
  const mirror: WhoopMirror = { cycles: [], recoveries: [], sleeps: [], workouts: [] };
  const first = addDays(lastDay, -(days - 1));

  for (let index = 0; index < days; index += 1) {
    const day = addDays(first, index);
    const trainingDay = trainingDates.has(day);
    const state = stateFor(index, days, trainingDay);
    const id = 100000 + index;

    const cycle: WhoopCycleRow = {
      id,
      localDay: day,
      start: instant(day, 4),
      end: instant(addDays(day, 1), 3, 59),
      timezone_offset: '-04:00',
      score_state: state,
    };
    if (state === 'SCORED') {
      cycle.score = {
        strain: round(8 + prng.next() * 8 + (trainingDay ? 3 : 0), 1),
        kilojoule: Math.round(7000 + prng.next() * 4000),
        average_heart_rate: Math.round(58 + prng.next() * 12),
        max_heart_rate: Math.round(150 + prng.next() * 30),
      };
    }
    mirror.cycles.push(cycle);

    const sleep: WhoopSleepRow = {
      id,
      localDay: day,
      start: instant(day, 23),
      end: instant(addDays(day, 1), 7),
      nap: false,
      score_state: state,
    };
    if (state === 'SCORED') {
      const inBed = Math.round((7 + prng.next() * 1.5) * 3600000);
      sleep.score = {
        sleep_performance_percentage: Math.round(72 + prng.next() * 24),
        sleep_consistency_percentage: Math.round(60 + prng.next() * 30),
        sleep_efficiency_percentage: Math.round(85 + prng.next() * 12),
        total_in_bed_time_milli: inBed,
        total_slow_wave_sleep_time_milli: Math.round(inBed * (0.15 + prng.next() * 0.08)),
        total_rem_sleep_time_milli: Math.round(inBed * (0.18 + prng.next() * 0.08)),
      };
    }
    mirror.sleeps.push(sleep);

    const recovery: WhoopRecoveryRow = {
      cycle_id: id,
      sleep_id: id,
      localDay: day,
      score_state: state,
    };
    if (state === 'SCORED') {
      recovery.score = {
        user_calibrating: false,
        recovery_score: Math.round(30 + prng.next() * 60),
        resting_heart_rate: Math.round(46 + prng.next() * 10),
        hrv_rmssd_milli: round(55 + prng.next() * 45, 1),
        spo2_percentage: round(95 + prng.next() * 3, 1),
        skin_temp_celsius: round(33 + prng.next() * 1.5, 1),
      };
    }
    mirror.recoveries.push(recovery);

    if (!trainingDay) continue;
    const workout: WhoopWorkoutRow = {
      id: 200000 + index,
      localDay: day,
      start: instant(day, 17, 30),
      end: instant(day, 18, 45),
      sport_id: WHOOP_SPORT_WEIGHTLIFTING,
      score_state: state === 'UNSCORABLE' ? 'UNSCORABLE' : state,
      };
    if (workout.score_state === 'SCORED') {
      workout.score = {
        strain: round(9 + prng.next() * 5, 1),
        average_heart_rate: Math.round(105 + prng.next() * 20),
        max_heart_rate: Math.round(155 + prng.next() * 25),
        kilojoule: Math.round(1600 + prng.next() * 900),
      };
    }
    mirror.workouts.push(workout);
  }

  return mirror;
}
