/**
 * Reading the export out of the server's copy, and shaping the five CSVs.
 *
 * Column names and their order are the phone's, from
 * apps/mobile/src/features/settings/exportData.ts, so the two exports are the
 * same file. Storage units go out raw (millimetres, kilograms, seconds) with a
 * display column beside them, so nothing is lost to rounding and a spreadsheet
 * still reads the numbers the app showed.
 *
 * Session status is derived here exactly as the phone derives it on read: a
 * finish is a log event, never a stamp, and an undone finish stops counting.
 */

import { asc, isNull } from 'drizzle-orm';
import type { Database } from '../../db/client';
import {
  athlete,
  jumpRep,
  jumpTestSession,
  readinessTestSession,
  session,
  sessionEvent,
  setLog,
  week,
} from '../../db/tables/mirror';
import { sessionWorkoutLink, whoopRecovery, whoopWorkout } from '../../db/tables/whoop';
import { displayLoadLb, formatHeightValueIn, localDayIn, round, toCsv, type Cell } from './csv';

type TestRow = typeof jumpTestSession.$inferSelect;
type RepRow = typeof jumpRep.$inferSelect;
type SetLogRow = typeof setLog.$inferSelect;
type WeekRow = typeof week.$inferSelect;
type SessionRow = typeof session.$inferSelect;
type RecoveryRow = typeof whoopRecovery.$inferSelect;
type WorkoutRow = typeof whoopWorkout.$inferSelect;
type ReadinessRow = typeof readinessTestSession.$inferSelect;

export type SessionStatus = 'planned' | 'not_finished' | 'done' | 'missed';

export interface TestWithReps extends TestRow {
  readonly reps: readonly RepRow[];
}

export interface SessionWithStatus extends SessionRow {
  readonly status: SessionStatus;
  readonly loggedSetCount: number;
  readonly startedAt: string | null;
  readonly markedCompleteAt: string | null;
  readonly whoopWorkoutId: string | null;
}

export interface ExportSource {
  readonly today: string;
  readonly tests: readonly TestWithReps[];
  readonly sessions: readonly SessionWithStatus[];
  readonly setLogs: readonly SetLogRow[];
  readonly weeks: readonly WeekRow[];
  readonly recovery: readonly RecoveryRow[];
  readonly workouts: readonly WorkoutRow[];
  /** The readiness gate's own stream (`house.sc.readiness_gate`). */
  readonly readiness: readonly ReadinessRow[];
}

/**
 * planned  nothing logged and the day has not passed
 * not_finished  logs but no finish mark, whatever the date
 * done  a finish mark that has not been undone
 * missed  the day has passed with nothing logged and no mark
 */
export function deriveStatus(
  loggedSetCount: number,
  markedCompleteAt: string | null,
  scheduledDate: string | null,
  today: string,
): SessionStatus {
  if (markedCompleteAt !== null) return 'done';
  if (loggedSetCount > 0) return 'not_finished';
  // A session the phone has not told the server the date of cannot be late.
  if (scheduledDate === null) return 'planned';
  return scheduledDate < today ? 'missed' : 'planned';
}

function smallest(values: readonly string[]): string | null {
  let best: string | null = null;
  for (const value of values) if (best === null || value < best) best = value;
  return best;
}

/** Everything the export reads, in one pass over the tables. */
export async function readExportSource(db: Database, now: Date = new Date()): Promise<ExportSource> {
  const athletes = await db.select({ timezone: athlete.timezone }).from(athlete).limit(1);
  const today = localDayIn(athletes[0]?.timezone ?? 'UTC', now);

  const tests = await db
    .select()
    .from(jumpTestSession)
    .where(isNull(jumpTestSession.deletedAt))
    .orderBy(asc(jumpTestSession.localDate), asc(jumpTestSession.performedAt));
  const reps = await db.select().from(jumpRep).orderBy(asc(jumpRep.attemptIndex));
  const repsByTest = new Map<string, RepRow[]>();
  for (const rep of reps) {
    const list = repsByTest.get(rep.jumpTestSessionId) ?? [];
    list.push(rep);
    repsByTest.set(rep.jumpTestSessionId, list);
  }

  const setLogs = await db
    .select()
    .from(setLog)
    .where(isNull(setLog.deletedAt))
    .orderBy(asc(setLog.completedAt), asc(setLog.id));
  const weeks = await db.select().from(week).orderBy(asc(week.programId), asc(week.w));
  const sessions = await db
    .select()
    .from(session)
    .orderBy(asc(session.scheduledDate), asc(session.orderIndex));
  const events = await db.select().from(sessionEvent);
  const links = await db.select().from(sessionWorkoutLink);

  const linkBySession = new Map(links.map((link) => [link.sessionId, link.whoopWorkoutId]));
  const logsBySession = new Map<string, SetLogRow[]>();
  for (const log of setLogs) {
    const list = logsBySession.get(log.sessionId) ?? [];
    list.push(log);
    logsBySession.set(log.sessionId, list);
  }

  const derived: SessionWithStatus[] = sessions.map((row) => {
    const own = events.filter((event) => event.sessionId === row.id);
    const logs = logsBySession.get(row.id) ?? [];
    const startEvents = own.filter((event) => event.kind === 'start').map((event) => event.at);
    const startedAt =
      smallest(startEvents) ?? smallest(logs.map((log) => log.completedAt));
    const undone = own
      .filter((event) => event.kind === 'uncomplete')
      .reduce<string>((latest, event) => (event.at > latest ? event.at : latest), '');
    const completes = own
      .filter((event) => event.kind === 'complete' && event.at > undone)
      .map((event) => event.at)
      .sort();
    const markedCompleteAt = completes[completes.length - 1] ?? null;
    return {
      ...row,
      status: deriveStatus(logs.length, markedCompleteAt, row.scheduledDate, today),
      loggedSetCount: logs.length,
      startedAt,
      markedCompleteAt,
      whoopWorkoutId: linkBySession.get(row.id) ?? null,
    };
  });

  const recovery = await db.select().from(whoopRecovery).orderBy(asc(whoopRecovery.localDate));
  const workouts = await db.select().from(whoopWorkout).orderBy(asc(whoopWorkout.localDate));
  const readiness = await db
    .select()
    .from(readinessTestSession)
    .orderBy(asc(readinessTestSession.localDate), asc(readinessTestSession.createdAt));

  return {
    today,
    tests: tests.map((test) => ({ ...test, reps: repsByTest.get(test.id) ?? [] })),
    sessions: derived,
    setLogs,
    weeks,
    recovery,
    workouts,
    readiness,
  };
}

/* ------------------------------------------------------------------ csvs */

/** One row per jump attempt, with its test's conditions repeated. */
export function testsCsv(tests: readonly TestWithReps[]): string {
  const header = [
    'test_id', 'local_date', 'performed_at', 'instrument', 'mode', 'canonical', 'is_baseline',
    'scheduled', 'box_height_mm', 'bodyweight_kg', 'device_firmware', 'connect_version', 'notes',
    'attempt', 'height_mm', 'height_in', 'gct_ms', 'rsi_calc', 'rsi_device', 'flagged',
    'reject_reason', 'entry_source', 'import_batch_id',
  ];
  const rows: Cell[][] = [];
  for (const test of tests) {
    for (const rep of test.reps) {
      rows.push([
        test.id, test.localDate, test.performedAt, test.instrument, test.mode,
        test.canonical, test.isBaseline, test.scheduled, test.boxHeightMm,
        round(test.bodyweightKg, 3), test.deviceFirmware, test.connectVersion, test.notes,
        rep.attemptIndex, round(rep.heightMm, 2),
        rep.heightMm === null ? null : formatHeightValueIn(rep.heightMm),
        rep.gctMs, round(rep.rsiCalc, 3), round(rep.rsiDevice, 3), rep.flagged,
        rep.rejectReason, rep.entrySource, rep.importBatchId,
      ]);
    }
  }
  return toCsv(header, rows);
}

export function setLogsCsv(logs: readonly SetLogRow[]): string {
  const header = [
    'set_log_id', 'session_id', 'session_exercise_id', 'set_number', 'reps_done',
    'load_kg', 'load_lb', 'duration_s', 'distance_m', 'box_height_mm', 'landing', 'rpe',
    'mean_velocity_best', 'mean_velocity_last', 'velocity_loss_pct', 'load_source',
    'entry_source', 'completed_at', 'planned_date', 'offset_days', 'idempotency_key', 'edited_at',
  ];
  const rows = logs.map((log): Cell[] => [
    log.id, log.sessionId, log.sessionExerciseId, log.setNumber, log.repsDone,
    round(log.loadKg, 3),
    log.loadKg === null ? null : displayLoadLb(log.loadKg),
    log.durationS, log.distanceM, log.boxHeightMm, log.landing, log.rpe,
    round(log.meanVelocityBest, 2), round(log.meanVelocityLast, 2), round(log.velocityLossPct, 1),
    log.loadSource, log.entrySource, log.completedAt, log.plannedDate, log.offsetDays,
    log.idempotencyKey, log.editedAt,
  ]);
  return toCsv(header, rows);
}

export function sessionsCsv(sessions: readonly SessionWithStatus[]): string {
  const header = [
    'session_id', 'week_id', 'scheduled_date', 'order_index', 'day_type', 'status',
    'prescribed_sets', 'logged_sets', 'started_at', 'marked_complete_at', 'test_status',
    'soreness_pre', 'rpe', 'legs_feel', 'is_maximal_cns', 'whoop_workout_id', 'notes',
  ];
  const rows = sessions.map((row): Cell[] => [
    row.id, row.weekId, row.scheduledDate, row.orderIndex, row.dayType, row.status,
    row.prescribedSetCount, row.loggedSetCount, row.startedAt, row.markedCompleteAt,
    row.testStatus, row.sorenessPre, row.rpe, row.legsFeel, row.isMaximalCns,
    row.whoopWorkoutId, row.notes,
  ]);
  return toCsv(header, rows);
}

export function weeksCsv(weeks: readonly WeekRow[]): string {
  const header = [
    'week_id', 'program_id', 'w', 'window_start', 'window_end', 'kind', 'k',
    'prescribed_count', 'completed_count', 'adherence_pct', 'all_reps_completed', 'outcome',
    'repeat_of_week', 'high_contact_allowance', 'extensive_target', 'generated_at',
  ];
  const rows = weeks.map((row): Cell[] => [
    row.id, row.programId, row.w, row.windowStart, row.windowEnd, row.kind, row.k,
    row.prescribedCount, row.completedCount, row.adherencePct, row.allRepsCompleted, row.outcome,
    row.repeatOfWeek, row.highContactAllowance, row.extensiveTarget, row.generatedAt,
  ]);
  return toCsv(header, rows);
}

/** Whoop's own metric names, unabbreviated, as the terms require. */
export function whoopCsv(
  recovery: readonly RecoveryRow[],
  workouts: readonly WorkoutRow[],
): string {
  const header = [
    'kind', 'id', 'local_date', 'score_state', 'user_calibrating', 'recovery_score',
    'resting_heart_rate', 'hrv_rmssd_milli', 'sport_name', 'strain', 'average_heart_rate',
    'max_heart_rate', 'percent_recorded', 'start_at', 'end_at',
  ];
  const rows: Cell[][] = [];
  for (const day of recovery) {
    rows.push([
      'recovery', day.id, day.localDate, day.scoreState, day.userCalibrating, day.recoveryScore,
      day.restingHeartRate, round(day.hrvRmssdMilli, 2), null, null, null, null, null, null, null,
    ]);
  }
  for (const workout of workouts) {
    rows.push([
      'workout', workout.id, workout.localDate, workout.scoreState, false, null, null, null,
      workout.sportName, round(workout.strain, 2), workout.averageHeartRate, workout.maxHeartRate,
      round(workout.percentRecorded, 1), workout.startAt, workout.endAt,
    ]);
  }
  return toCsv(header, rows);
}

/**
 * The readiness gate's stream, one row a test. The attempts go out as they
 * were logged and `best` beside them, so a spreadsheet can see the day's
 * number without re-deriving it (`house.sc.readiness_gate`).
 */
export function readinessCsv(tests: readonly ReadinessRow[]): string {
  const header = [
    'id', 'local_date', 'kind', 'metric', 'unit', 'best', 'attempts', 'entry_source', 'created_at',
  ];
  const rows = tests.map((row): Cell[] => [
    row.id, row.localDate, row.kind, row.metric, row.unit, round(row.best, 3),
    row.attempts === null ? null : JSON.stringify(row.attempts),
    row.entrySource, row.createdAt,
  ]);
  return toCsv(header, rows);
}

/** The complete export, as one JSON document. This is the restorable copy. */
export function exportDocument(source: ExportSource, appVersion: string): string {
  return JSON.stringify(
    {
      exportedOn: source.today,
      appVersion,
      units: { height: 'mm', load: 'kg', duration: 's', velocity: 'm/s' },
      tests: source.tests,
      sessions: source.sessions,
      setLogs: source.setLogs,
      weeks: source.weeks,
      whoop: { recovery: source.recovery, workouts: source.workouts },
      readiness: source.readiness,
    },
    null,
    2,
  );
}
