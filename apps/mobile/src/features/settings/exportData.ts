/**
 * Building the export files from the store.
 *
 * The athlete owns this data and there is one copy of it, on this phone, so
 * the export is complete rather than convenient: every jump attempt, every
 * set log, every session and week, and the Whoop mirrors. Storage units go out
 * raw (millimetres, kilograms, seconds) so nothing is lost to rounding, and a
 * display column beside each one carries the engine's own formatter, so a
 * spreadsheet reads the same numbers the app showed.
 *
 * Pure: the screen fetches, this builds, the platform writer saves.
 */
import {
  displayLoadLb,
  formatHeightValueIn,
  formatVelocity,
  kgToLb,
  roundHalfUp,
} from '@vert/engine';
import type {
  JumpTestWithReps,
  LocalDate,
  SessionWithStatus,
  SetLog,
  Week,
  WhoopRecovery,
  WhoopWorkout,
} from '@/data';

export interface ExportFile {
  readonly name: string;
  readonly mime: 'text/csv' | 'application/json';
  readonly text: string;
  /** What the row in Settings calls it. */
  readonly label: string;
  readonly rowCount: number;
}

/** Everything the export reads. The screen fetches it; this file shapes it. */
export interface ExportSource {
  readonly today: LocalDate;
  readonly tests: readonly JumpTestWithReps[];
  readonly sessions: readonly SessionWithStatus[];
  readonly setLogs: readonly SetLog[];
  readonly weeks: readonly Week[];
  readonly recovery: readonly WhoopRecovery[];
  readonly workouts: readonly WhoopWorkout[];
  /** The app version stamped into the JSON so a future importer knows the shape. */
  readonly appVersion: string;
}

type Cell = string | number | boolean | null | undefined;

/** One CSV field, quoted only when it has to be. */
export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : `${value}`;
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/** A whole CSV, CRLF-terminated the way RFC 4180 asks. */
export function toCsv(header: readonly string[], rows: readonly (readonly Cell[])[]): string {
  const lines = [header.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

function round(value: number | null, decimals: number): number | null {
  return value === null ? null : roundHalfUp(value, decimals);
}

/** One row per jump attempt, with its test's conditions repeated. */
export function testsCsv(tests: readonly JumpTestWithReps[]): string {
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

export function setLogsCsv(logs: readonly SetLog[]): string {
  const header = [
    'set_log_id', 'session_id', 'session_exercise_id', 'set_number', 'reps_done',
    'load_kg', 'load_lb', 'duration_s', 'distance_m', 'box_height_mm', 'landing', 'rpe', 'side',
    'mean_velocity_best', 'mean_velocity_last', 'velocity_loss_pct', 'load_source',
    'entry_source', 'completed_at', 'planned_date', 'offset_days', 'idempotency_key', 'edited_at',
  ];
  const rows = logs.map((log): Cell[] => [
    log.id, log.sessionId, log.sessionExerciseId, log.setNumber, log.repsDone,
    round(log.loadKg, 3),
    log.loadKg === null ? null : displayLoadLb(log.loadKg, 'barbell'),
    log.durationS, log.distanceM, log.boxHeightMm, log.landing, log.rpe,
    log.side,
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
  const rows = sessions.map((session): Cell[] => [
    session.id, session.weekId, session.scheduledDate, session.orderIndex, session.dayType,
    session.status, session.prescribedSetCount, session.loggedSetCount, session.startedAt,
    session.markedCompleteAt, session.testStatus, session.sorenessPre, session.rpe,
    session.legsFeel, session.isMaximalCns, session.whoopWorkoutId, session.notes,
  ]);
  return toCsv(header, rows);
}

export function weeksCsv(weeks: readonly Week[]): string {
  const header = [
    'week_id', 'program_id', 'w', 'window_start', 'window_end', 'kind', 'k',
    'prescribed_count', 'completed_count', 'adherence_pct', 'all_reps_completed', 'outcome',
    'repeat_of_week', 'high_contact_allowance', 'extensive_target', 'generated_at',
  ];
  const rows = weeks.map((week): Cell[] => [
    week.id, week.programId, week.w, week.windowStart, week.windowEnd, week.kind, week.k,
    week.prescribedCount, week.completedCount, week.adherencePct, week.allRepsCompleted,
    week.outcome, week.repeatOfWeek, week.highContactAllowance, week.extensiveTarget,
    week.generatedAt,
  ]);
  return toCsv(header, rows);
}

/** Whoop's own metric names, unabbreviated, as the terms require. */
export function whoopCsv(
  recovery: readonly WhoopRecovery[],
  workouts: readonly WhoopWorkout[],
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

/** The complete export, as one JSON document. This is the restorable copy. */
export function exportJson(source: ExportSource): string {
  return JSON.stringify(
    {
      exportedOn: source.today,
      appVersion: source.appVersion,
      units: { height: 'mm', load: 'kg', duration: 's', velocity: 'm/s' },
      tests: source.tests,
      sessions: source.sessions,
      setLogs: source.setLogs,
      weeks: source.weeks,
      whoop: { recovery: source.recovery, workouts: source.workouts },
    },
    null,
    2,
  );
}

/** Every file the Export section offers, in the order it lists them. */
export function buildExportFiles(source: ExportSource): ExportFile[] {
  const stamp = source.today;
  const repCount = source.tests.reduce((total, test) => total + test.reps.length, 0);

  return [
    {
      name: `vert-tests-${stamp}.csv`,
      mime: 'text/csv',
      text: testsCsv(source.tests),
      label: 'Jump tests',
      rowCount: repCount,
    },
    {
      name: `vert-set-logs-${stamp}.csv`,
      mime: 'text/csv',
      text: setLogsCsv(source.setLogs),
      label: 'Set logs',
      rowCount: source.setLogs.length,
    },
    {
      name: `vert-sessions-${stamp}.csv`,
      mime: 'text/csv',
      text: sessionsCsv(source.sessions),
      label: 'Sessions',
      rowCount: source.sessions.length,
    },
    {
      name: `vert-weeks-${stamp}.csv`,
      mime: 'text/csv',
      text: weeksCsv(source.weeks),
      label: 'Weeks',
      rowCount: source.weeks.length,
    },
    {
      name: `vert-whoop-${stamp}.csv`,
      mime: 'text/csv',
      text: whoopCsv(source.recovery, source.workouts),
      label: 'Whoop mirrors',
      rowCount: source.recovery.length + source.workouts.length,
    },
    {
      name: `vert-export-${stamp}.json`,
      mime: 'application/json',
      text: exportJson(source),
      label: 'Everything, as JSON',
      rowCount:
        repCount + source.setLogs.length + source.sessions.length + source.weeks.length,
    },
  ];
}

/** Kept for the velocity column header, so the unit is written once. */
export const VELOCITY_EXAMPLE = formatVelocity(0.82);

/** Pounds, for a caption. Never a stored value. */
export function bodyweightLb(kg: number | null): number | null {
  return kg === null ? null : roundHalfUp(kgToLb(kg), 0);
}

export const BACKUP_REMINDER =
  'Everything lives on this phone. Export once a month so a lost phone is not a lost program.';
