import type { SqlExecutor } from '../executor';
import type { EntrySource, Landing, LocalDate, SetLog, Side, Timestamp } from '../types';
import { daysBetween } from '../../lib/localDay';
import type { SyncOp } from '../types';
import { newId, nowIso, oneOf, oneOfOrNull } from './rows';
import { markSessionStarted } from './sessions';
import { enqueue } from './sync';

/**
 * The outbox ops a write should carry, built from what was actually written.
 *
 * The contract is one unit of work: the row and its sync op land in the same
 * transaction, or neither lands. Enqueuing afterwards leaves a window in which
 * a process kill produces a set that is on the phone and will never reach the
 * server, with nothing in the app able to notice, because `pendingCount` only
 * ever knew about rows that made it into the queue.
 */
export type SyncOps<T> = (saved: T) => readonly SyncOp[];

const LANDINGS: readonly Landing[] = ['good', 'ok', 'poor'];
const SOURCES: readonly EntrySource[] = ['typed', 'imported', 'estimated'];
const SIDES: readonly Side[] = ['left', 'right'];

/** Sets stay editable for 7 days; notes and RPE stay editable forever. */
export const EDIT_WINDOW_DAYS = 7;

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

function mapSetLog(row: SetLogRow): SetLog {
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
    landing: oneOfOrNull(row.landing, LANDINGS),
    rpe: row.rpe,
    side: oneOfOrNull(row.side, SIDES),
    meanVelocityBest: row.mean_velocity_best,
    meanVelocityLast: row.mean_velocity_last,
    velocityLossPct: row.velocity_loss_pct,
    loadSource: row.load_source,
    entrySource: oneOf(row.entry_source, SOURCES, 'typed'),
    completedAt: row.completed_at,
    plannedDate: row.planned_date,
    offsetDays: row.offset_days,
    idempotencyKey: row.idempotency_key,
    editedAt: row.edited_at,
    createdAt: row.created_at,
  };
}

export interface LogSetInput {
  readonly sessionId: string;
  readonly sessionExerciseId: string;
  readonly setNumber: number;
  readonly repsDone?: number | null;
  readonly loadKg?: number | null;
  readonly durationS?: number | null;
  readonly distanceM?: number | null;
  readonly boxHeightMm?: number | null;
  readonly landing?: Landing | null;
  readonly rpe?: number | null;
  /**
   * Which leg or arm ran this set. Omitted, or null, is a set logged once for
   * both sides, which is what a plain tap on a unilateral row still writes.
   */
  readonly side?: Side | null;
  readonly meanVelocityBest?: number | null;
  readonly meanVelocityLast?: number | null;
  readonly velocityLossPct?: number | null;
  readonly loadSource?: string | null;
  readonly entrySource?: EntrySource;
  readonly completedAt?: Timestamp;
  readonly plannedDate?: LocalDate | null;
  /** The training day the tap happened on, used to compute offset_days. */
  readonly loggedOnDay?: LocalDate;
  /** Supply your own to make a retry idempotent across app restarts. */
  readonly idempotencyKey?: string;
}

/**
 * The default key makes one row per (session, exercise, set, side): a double
 * tap, a retry after a crash, and a replayed queue item all collapse onto the
 * same row rather than inflating the ledger.
 *
 * The side is part of the key because the two legs of one unilateral set are
 * two rows under one set number; a set logged for both sides at once carries no
 * side and keeps exactly the key it has always had, so no queued op and no row
 * already on file changes meaning.
 */
export function defaultIdempotencyKey(input: {
  sessionId: string;
  sessionExerciseId: string;
  setNumber: number;
  side?: Side | null;
}): string {
  const base = `set:${input.sessionId}:${input.sessionExerciseId}:${input.setNumber}`;
  const side = input.side ?? null;
  return side === null ? base : `${base}:${side}`;
}

function offsetDays(plannedDate: LocalDate | null | undefined, loggedOn: LocalDate | undefined): number {
  if (plannedDate === null || plannedDate === undefined || loggedOn === undefined) return 0;
  return daysBetween(plannedDate, loggedOn);
}

/**
 * Log one set. Local first, inside a transaction, and idempotent: the second
 * call with the same key returns the row the first call wrote.
 */
export async function logSet(
  db: SqlExecutor,
  input: LogSetInput,
  ops?: SyncOps<SetLog>,
): Promise<SetLog> {
  const key = input.idempotencyKey ?? defaultIdempotencyKey(input);
  const completedAt = input.completedAt ?? nowIso();
  const id = newId('slog');
  let saved: SetLog | null = null;

  await db.withTransactionAsync(async () => {
    await markSessionStarted(db, input.sessionId, completedAt);
    await db.runAsync(
      `INSERT INTO set_log
         (id, session_id, session_exercise_id, set_number, reps_done, load_kg, duration_s,
          distance_m, box_height_mm, landing, rpe, side, mean_velocity_best, mean_velocity_last,
          velocity_loss_pct, load_source, entry_source, completed_at, planned_date, offset_days,
          idempotency_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
      [
        id,
        input.sessionId,
        input.sessionExerciseId,
        input.setNumber,
        input.repsDone ?? null,
        input.loadKg ?? null,
        input.durationS ?? null,
        input.distanceM ?? null,
        input.boxHeightMm ?? null,
        input.landing ?? null,
        input.rpe ?? null,
        input.side ?? null,
        input.meanVelocityBest ?? null,
        input.meanVelocityLast ?? null,
        input.velocityLossPct ?? null,
        input.loadSource ?? null,
        input.entrySource ?? 'typed',
        completedAt,
        input.plannedDate ?? null,
        offsetDays(input.plannedDate, input.loggedOnDay),
        key,
        nowIso(),
      ],
    );

    // Either key wins the race: the caller's own key, or the one-row-per-set
    // index that makes a double tap collapse onto the row already written. The
    // index reads the side too, so the left leg never resolves to the right
    // leg's row.
    const row =
      (await db.getFirstAsync<SetLogRow>('SELECT * FROM set_log WHERE idempotency_key = ?', [
        key,
      ])) ??
      (await db.getFirstAsync<SetLogRow>(
        `SELECT * FROM set_log
           WHERE session_exercise_id = ? AND set_number = ?
             AND COALESCE(side, 'both') = ?`,
        [input.sessionExerciseId, input.setNumber, input.side ?? 'both'],
      ));
    if (row === null) throw new Error('logSet: the set log did not save.');
    saved = mapSetLog(row);
    if (ops !== undefined) for (const op of ops(saved)) await enqueue(db, op);
  });

  if (saved === null) throw new Error('logSet: the set log did not save.');
  return saved;
}

/**
 * Tap again to undo, within the session. Deletes the log for that one set,
 * both legs included: the row was prescribed once, so taking it back takes back
 * everything logged under that set number.
 */
export async function undoSet(
  db: SqlExecutor,
  sessionExerciseId: string,
  setNumber: number,
  ops?: SyncOps<boolean>,
): Promise<boolean> {
  let removed = false;
  await db.withTransactionAsync(async () => {
    const result = await db.runAsync(
      'DELETE FROM set_log WHERE session_exercise_id = ? AND set_number = ?',
      [sessionExerciseId, setNumber],
    );
    removed = result.changes > 0;
    if (removed && ops !== undefined) for (const op of ops(removed)) await enqueue(db, op);
  });
  return removed;
}

export async function listSetLogs(db: SqlExecutor, sessionId: string): Promise<SetLog[]> {
  const rows = await db.getAllAsync<SetLogRow>(
    'SELECT * FROM set_log WHERE session_id = ? ORDER BY completed_at, set_number',
    [sessionId],
  );
  return rows.map(mapSetLog);
}

export async function getSetLog(db: SqlExecutor, setLogId: string): Promise<SetLog | null> {
  const row = await db.getFirstAsync<SetLogRow>('SELECT * FROM set_log WHERE id = ?', [setLogId]);
  return row === null ? null : mapSetLog(row);
}

export interface SetLogPatch {
  readonly repsDone?: number | null;
  readonly loadKg?: number | null;
  readonly durationS?: number | null;
  readonly distanceM?: number | null;
  readonly boxHeightMm?: number | null;
  readonly landing?: Landing | null;
  readonly rpe?: number | null;
  readonly meanVelocityBest?: number | null;
  readonly meanVelocityLast?: number | null;
  readonly velocityLossPct?: number | null;
}

export class EditWindowClosedError extends Error {
  constructor(public readonly setLogId: string) {
    super('That set is older than 7 days and can no longer be edited.');
    this.name = 'EditWindowClosedError';
  }
}

export function isWithinEditWindow(completedAt: Timestamp, now: Date = new Date()): boolean {
  const logged = new Date(completedAt).getTime();
  if (Number.isNaN(logged)) return false;
  return now.getTime() - logged <= EDIT_WINDOW_DAYS * 86_400_000;
}

/** Edits are allowed for 7 days. Past that the ledger is closed, by design. */
export async function editSet(
  db: SqlExecutor,
  setLogId: string,
  patch: SetLogPatch,
  now: Date = new Date(),
  ops?: SyncOps<SetLog>,
): Promise<SetLog> {
  const existing = await getSetLog(db, setLogId);
  if (existing === null) throw new Error(`editSet: no set log ${setLogId}.`);
  if (!isWithinEditWindow(existing.completedAt, now)) throw new EditWindowClosedError(setLogId);

  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  const put = (column: string, value: string | number | null): void => {
    sets.push(`${column} = ?`);
    params.push(value);
  };

  if (patch.repsDone !== undefined) put('reps_done', patch.repsDone);
  if (patch.loadKg !== undefined) put('load_kg', patch.loadKg);
  if (patch.durationS !== undefined) put('duration_s', patch.durationS);
  if (patch.distanceM !== undefined) put('distance_m', patch.distanceM);
  if (patch.boxHeightMm !== undefined) put('box_height_mm', patch.boxHeightMm);
  if (patch.landing !== undefined) put('landing', patch.landing);
  if (patch.rpe !== undefined) put('rpe', patch.rpe);
  if (patch.meanVelocityBest !== undefined) put('mean_velocity_best', patch.meanVelocityBest);
  if (patch.meanVelocityLast !== undefined) put('mean_velocity_last', patch.meanVelocityLast);
  if (patch.velocityLossPct !== undefined) put('velocity_loss_pct', patch.velocityLossPct);

  let saved: SetLog | null = null;
  await db.withTransactionAsync(async () => {
    if (sets.length > 0) {
      put('edited_at', now.toISOString());
      params.push(setLogId);
      await db.runAsync(`UPDATE set_log SET ${sets.join(', ')} WHERE id = ?`, params);
    }
    saved = await getSetLog(db, setLogId);
    if (saved === null) throw new Error('editSet: the set log vanished mid-edit.');
    if (ops !== undefined) for (const op of ops(saved)) await enqueue(db, op);
  });

  if (saved === null) throw new Error('editSet: the set log vanished mid-edit.');
  return saved;
}

/**
 * Which set numbers of an exercise already have a log, for the row state.
 *
 * Distinct, so a unilateral set logged on both legs counts as the one set the
 * row prescribed and the runner's done count, next-set jump and fold label all
 * read the same as they did before sides existed.
 */
export async function loggedSetNumbers(
  db: SqlExecutor,
  sessionExerciseId: string,
): Promise<number[]> {
  const rows = await db.getAllAsync<{ set_number: number }>(
    'SELECT DISTINCT set_number FROM set_log WHERE session_exercise_id = ? ORDER BY set_number',
    [sessionExerciseId],
  );
  return rows.map((row) => row.set_number);
}

/** True when the row came from an import rather than a tap in the gym. */
export function isImported(log: SetLog): boolean {
  return log.entrySource === 'imported';
}
