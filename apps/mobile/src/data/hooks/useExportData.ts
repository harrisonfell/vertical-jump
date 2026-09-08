import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useDbOrNull, useToday } from '../db';
import type { SqlExecutor } from '../executor';
import type {
  JumpTestWithReps,
  LocalDate,
  SessionWithStatus,
  SetLog,
  Week,
  WhoopRecovery,
  WhoopWorkout,
} from '../types';
import { listJumpTests } from '../store/jumpTests';
import { getCurrentProgram, listWeeks } from '../store/program';
import { listSessionsBetween } from '../store/sessions';
import { listRecovery, listWorkoutsBetween } from '../store/whoop';

/**
 * Everything the Settings export writes out, in one query.
 *
 * The export has to be complete or it is not a backup, so this reads the whole
 * store rather than a window: every jump test with its reps, every session and
 * its logs, every week, and the Whoop mirrors. It runs only when the athlete
 * opens the export section, so the cost never lands on the daily path.
 */

export interface ExportData {
  readonly today: LocalDate;
  readonly tests: readonly JumpTestWithReps[];
  readonly sessions: readonly SessionWithStatus[];
  readonly setLogs: readonly SetLog[];
  readonly weeks: readonly Week[];
  readonly recovery: readonly WhoopRecovery[];
  readonly workouts: readonly WhoopWorkout[];
}

interface SetLogRow {
  readonly id: string;
  readonly session_id: string;
  readonly session_exercise_id: string;
  readonly set_number: number;
  readonly reps_done: number | null;
  readonly load_kg: number | null;
  readonly duration_s: number | null;
  readonly distance_m: number | null;
  readonly box_height_mm: number | null;
  readonly landing: string | null;
  readonly rpe: number | null;
  readonly side: string | null;
  readonly mean_velocity_best: number | null;
  readonly mean_velocity_last: number | null;
  readonly velocity_loss_pct: number | null;
  readonly load_source: string | null;
  readonly entry_source: string;
  readonly completed_at: string;
  readonly planned_date: string | null;
  readonly offset_days: number;
  readonly idempotency_key: string;
  readonly edited_at: string | null;
  readonly created_at: string;
}

const LANDINGS = ['good', 'ok', 'poor'] as const;
const SIDES = ['left', 'right'] as const;
const SOURCES = ['typed', 'imported', 'estimated'] as const;

function mapLog(row: SetLogRow): SetLog {
  return {
    id: row.id,
    sessionId: row.session_id,
    sessionExerciseId: row.session_exercise_id,
    setNumber: row.set_number,
    repsDone: row.reps_done,
    loadKg: row.load_kg,
    durationS: row.duration_s,
    distanceM: row.distance_m,
    boxHeightMm: row.box_height_mm,
    landing: LANDINGS.find((entry) => entry === row.landing) ?? null,
    rpe: row.rpe,
    side: SIDES.find((entry) => entry === row.side) ?? null,
    meanVelocityBest: row.mean_velocity_best,
    meanVelocityLast: row.mean_velocity_last,
    velocityLossPct: row.velocity_loss_pct,
    loadSource: row.load_source,
    entrySource: SOURCES.find((entry) => entry === row.entry_source) ?? 'typed',
    completedAt: row.completed_at,
    plannedDate: row.planned_date,
    offsetDays: row.offset_days,
    idempotencyKey: row.idempotency_key,
    editedAt: row.edited_at,
    createdAt: row.created_at,
  };
}

/** Read the whole store for the export. One pass, oldest first. */
export async function readExportData(db: SqlExecutor, today: LocalDate): Promise<ExportData> {
  const program = await getCurrentProgram(db);
  const weeks = program === null ? [] : await listWeeks(db, program.id);

  const first = weeks[0]?.windowStart ?? today;
  const last = weeks[weeks.length - 1]?.windowEnd ?? today;

  const sessions = await listSessionsBetween(db, first, last, today);
  const rows = await db.getAllAsync<SetLogRow>(
    'SELECT * FROM set_log ORDER BY completed_at, set_number',
  );

  const recovery = await listRecovery(db, first, last);
  const workouts = await listWorkoutsBetween(
    db,
    `${first}T00:00:00.000Z`,
    `${last}T23:59:59.999Z`,
  );

  return {
    today,
    tests: await listJumpTests(db),
    sessions,
    setLogs: rows.map(mapLog),
    weeks,
    recovery,
    workouts,
  };
}

const EMPTY: ExportData = {
  today: '',
  tests: [],
  sessions: [],
  setLogs: [],
  weeks: [],
  recovery: [],
  workouts: [],
};

/** Gathers the export. Disabled until the athlete opens the export section. */
export function useExportData(enabled = false): UseQueryResult<ExportData> {
  const db = useDbOrNull();
  const today = useToday();
  return useQuery({
    queryKey: ['export', today],
    enabled: db !== null && enabled,
    queryFn: async () => (db === null ? { ...EMPTY, today } : readExportData(db, today)),
  });
}
