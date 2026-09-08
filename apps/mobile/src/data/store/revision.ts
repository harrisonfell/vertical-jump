import { mmToIn } from '@vert/engine';
import type { LoadMode, SetLog as EngineSetLog } from '@vert/engine';
import type { SqlExecutor } from '../executor';
import type { Json, Landing, Side } from '../types';
import { fromJson, newId, nowIso, oneOf, oneOfOrNull, toJsonRequired } from './rows';

/**
 * The reads and writes a revision needs, and nothing else.
 *
 * A revision re-materialises the unstarted weeks from what the athlete really
 * logged, which means feeding the engine two things the ordinary screens never
 * ask for: a whole week's set logs in the engine's own shape, and permission
 * to remove the sessions of a week it is about to rewrite. It also has to put
 * back the two rows the build wrote once and nobody has updated since, the
 * program's stored skeleton and its block bands, when a folded week moves the
 * calendar. All of it lives here rather than in `sessions.ts` or `program.ts`,
 * both of which are already near the file cap.
 *
 * The id remap is the load-bearing part. The store names a session
 * `sess_ln4k...`; the engine names the same session `w7-d1` and looks its sets
 * up by `sessionId + exerciseId + setNumber` against the plan it wrote. Hand
 * the store's id to the engine and `judgeReps` matches nothing, every real week
 * reads as "no reps logged", and every outcome silently becomes a hold that
 * drops working maxes. So every row that crosses this seam is renamed here.
 */

const LOAD_MODES: readonly LoadMode[] = ['entered', 'epley', 'rpe', 'week1', 'velocity', 'none'];
const LANDINGS: readonly Landing[] = ['good', 'ok', 'poor'];
const SIDES: readonly Side[] = ['left', 'right'];

interface EngineLogRow {
  readonly id: string;
  readonly set_number: number;
  readonly reps_done: number | null;
  readonly load_kg: number | null;
  readonly duration_s: number | null;
  readonly box_height_mm: number | null;
  readonly landing: string | null;
  readonly rpe: number | null;
  readonly side: string | null;
  readonly mean_velocity_best: number | null;
  readonly mean_velocity_last: number | null;
  readonly velocity_loss_pct: number | null;
  readonly load_source: string | null;
  readonly completed_at: string;
  readonly planned_date: string | null;
  readonly idempotency_key: string;
  readonly exercise_id: string;
  readonly load_mode: string;
  readonly order_index: number;
  readonly scheduled_date: string;
  readonly session_snapshot: string | null;
  readonly w: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The name the engine knows a session by.
 *
 * `SessionPlan.id` is written as `w${week.w}-d${session.dayIndex}` when the
 * week is assembled, and the store writes sessions in skeleton order, so a
 * session with no readable snapshot falls back to its own position. The
 * fallback is only ever reached by a row written before snapshots were kept.
 */
export function engineSessionId(snapshot: Json, w: number, orderIndex: number): string {
  const plan = isRecord(snapshot) ? snapshot : null;
  const id = plan?.['id'];
  return typeof id === 'string' && id !== '' ? id : `w${w}-d${orderIndex}`;
}

/** The same, from the raw column, for a row read inside this module. */
function engineSessionIdFromRow(row: EngineLogRow): string {
  return engineSessionId(fromJson(row.session_snapshot) as Json, row.w, row.order_index);
}

function toEngineLog(row: EngineLogRow): EngineSetLog {
  const log: EngineSetLog = {
    id: row.id,
    sessionId: engineSessionIdFromRow(row),
    exerciseId: row.exercise_id,
    setNumber: row.set_number,
    loadSource: oneOf(row.load_source ?? row.load_mode, LOAD_MODES, 'entered'),
    completedAt: row.completed_at,
    plannedDate: row.planned_date ?? row.scheduled_date,
    idempotencyKey: row.idempotency_key,
  };
  if (row.reps_done !== null) log.repsDone = row.reps_done;
  if (row.load_kg !== null) log.loadKg = row.load_kg;
  if (row.duration_s !== null) log.durationS = row.duration_s;
  if (row.box_height_mm !== null) log.boxHeightIn = mmToIn(row.box_height_mm);
  if (row.rpe !== null) log.rpe = row.rpe;
  if (row.mean_velocity_best !== null) log.meanVelocityBest = row.mean_velocity_best;
  if (row.mean_velocity_last !== null) log.meanVelocityLast = row.mean_velocity_last;
  if (row.velocity_loss_pct !== null) log.velocityLoss = row.velocity_loss_pct;
  const landing = oneOfOrNull(row.landing, LANDINGS);
  if (landing !== null) log.landing = landing;
  // The side has to reach the engine or the per-side effort gap dies here: it
  // is what names the weaker leg on next week's unilateral rows.
  const side = oneOfOrNull(row.side, SIDES);
  if (side !== null) log.side = side;
  return log;
}

/**
 * Every set logged anywhere in one week, in the engine's own `SetLog` shape.
 *
 * The join is what makes this a store concern: the store keys a log by
 * `session_exercise_id`, and the engine keys one by `exerciseId`, so the row
 * that holds the exercise has to be read to translate. The session id is
 * remapped at the same time, for the reason at the top of this file.
 */
export async function listWeekEngineLogs(
  db: SqlExecutor,
  weekId: string,
): Promise<EngineSetLog[]> {
  const rows = await db.getAllAsync<EngineLogRow>(
    `SELECT l.id, l.set_number, l.reps_done, l.load_kg, l.duration_s, l.box_height_mm,
            l.landing, l.rpe, l.side, l.mean_velocity_best, l.mean_velocity_last, l.velocity_loss_pct,
            l.load_source, l.completed_at, l.planned_date, l.idempotency_key,
            x.exercise_id AS exercise_id, x.load_mode AS load_mode,
            s.order_index AS order_index, s.scheduled_date AS scheduled_date,
            s.snapshot AS session_snapshot,
            wk.w AS w
       FROM set_log l
       JOIN session_exercise x ON x.id = l.session_exercise_id
       JOIN session s ON s.id = l.session_id
       JOIN week wk ON wk.id = s.week_id
      WHERE s.week_id = ?
      ORDER BY s.order_index, x.order_index, l.set_number`,
    [weekId],
  );
  return rows.map(toEngineLog);
}

/**
 * Remove one session and everything under it.
 *
 * `session_exercise`, `session_event` and `set_log` all declare
 * `ON DELETE CASCADE` against `session`, and every executor opens with
 * `PRAGMA foreign_keys = ON`, so the one statement clears the row and its
 * children together. A revision only ever calls this for a week with nothing
 * logged in it, which the caller checks first.
 */
export async function deleteSession(db: SqlExecutor, sessionId: string): Promise<boolean> {
  const result = await db.runAsync('DELETE FROM session WHERE id = ?', [sessionId]);
  return result.changes > 0;
}

/** Every session of a week, removed. Returns how many rows went. */
export async function deleteWeekSessions(db: SqlExecutor, weekId: string): Promise<number> {
  const rows = await db.getAllAsync<{ id: string }>(
    'SELECT id FROM session WHERE week_id = ? ORDER BY order_index',
    [weekId],
  );
  let removed = 0;
  for (const row of rows) {
    if (await deleteSession(db, row.id)) removed += 1;
  }
  return removed;
}

/* ------------------------------------------------- the calendar, rewritten */

/** One block band, as the `block` table holds it. */
export interface BlockRowInput {
  readonly type: string;
  readonly orderIndex: number;
  readonly weekStart: number;
  readonly weekEnd: number;
}

/**
 * Replace a program's block rows with the bands a revised skeleton carries.
 *
 * A week that folded in below the repeat threshold makes the engine clone it
 * and pay for the clone out of a later load week or the taper, which moves
 * every block boundary after it. The build wrote these rows once and nothing
 * has updated them since, so the Plan would keep drawing the old bands over
 * the new weeks: a Strength band a week too long, a Peak band starting on a
 * week that is now Strength.
 *
 * Delete and insert rather than upsert, because a rebuilt skeleton may hold a
 * different number of bands and `block` is unique on `(program_id,
 * order_index)`. `week.block_id` is deliberately left alone: no foreign key
 * points at these rows, and every screen that draws a band reads the week
 * range on the row rather than the id.
 */
export async function replaceBlocks(
  db: SqlExecutor,
  programId: string,
  blocks: readonly BlockRowInput[],
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM block WHERE program_id = ?', [programId]);
    for (const block of blocks) {
      await db.runAsync(
        `INSERT INTO block (id, program_id, type, order_index, week_start, week_end)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [newId('blk'), programId, block.type, block.orderIndex, block.weekStart, block.weekEnd],
      );
    }
  });
}

/**
 * The program's stored skeleton, replaced by the one a revision ended on.
 *
 * The Plan draws its week bands and its calendar from this column, and the
 * next revision reads it as the plan to project from, so a skeleton whose
 * weeks have moved has to land here or the move is lost on the next pass.
 * A revision only calls this when the week sequence actually changed; a
 * projection that merely moved targets leaves the planned calendar alone.
 */
export async function updateProgramSnapshot(
  db: SqlExecutor,
  programId: string,
  snapshot: Json,
): Promise<void> {
  await db.runAsync('UPDATE program SET snapshot = ?, updated_at = ? WHERE id = ?', [
    toJsonRequired(snapshot),
    nowIso(),
    programId,
  ]);
}
