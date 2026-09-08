import type { SqlExecutor } from '../executor';
import type {
  AdherenceInputs,
  DayType,
  Json,
  LocalDate,
  Session,
  SessionEventKind,
  SessionExercise,
  SessionStatus,
  SessionWithStatus,
  TestStatus,
  Timestamp,
} from '../types';
import { bool, fromJson, intBool, newId, nowIso, oneOf, oneOfOrNull, toJson, toJsonRequired } from './rows';

const TEST_STATUSES: readonly TestStatus[] = ['planned', 'done', 'deferred', 'missed'];

const LOAD_MODES = ['entered', 'epley', 'rpe', 'week1', 'velocity'] as const;

interface SessionRow {
  readonly id: string;
  readonly program_id: string;
  readonly week_id: string;
  readonly scheduled_date: string;
  readonly order_index: number;
  readonly day_type: string;
  readonly blocks_present: string | null;
  readonly prescribed_set_count: number;
  readonly dismissed: number;
  readonly test_status: string | null;
  readonly soreness_pre: number | null;
  readonly rpe: number | null;
  readonly legs_feel: string | null;
  readonly notes: string | null;
  readonly is_maximal_cns: number;
  readonly trimmed_exercises: string | null;
  readonly applied_modifications: string | null;
  readonly shadow_modifications: string | null;
  readonly snapshot: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface DerivedRow extends SessionRow {
  readonly logged_set_count: number;
  readonly started_at: string | null;
  readonly marked_complete_at: string | null;
  readonly whoop_workout_id: string | null;
}

interface ExerciseRow {
  readonly id: string;
  readonly session_id: string;
  readonly order_index: number;
  readonly exercise_id: string;
  readonly exercise_name: string;
  readonly block: string | null;
  readonly load_type: string;
  readonly load_mode: string;
  readonly both_sides: number;
  readonly rotation_note: string | null;
  readonly header_note: string | null;
  readonly last_time_note: string | null;
  readonly is_new_this_week: number;
  readonly rest_s: number | null;
  readonly rest_rule: string | null;
  readonly per_set: string;
}

/**
 * Everything a screen needs about a session's progress, derived on read.
 *
 * `marked_complete_at` is the latest complete event that has not been undone;
 * `started_at` is the earliest start event or, when a session was logged
 * without one, the first set log. Nothing here is a stored status stamp.
 */
const DERIVED_SELECT = `
SELECT s.*,
  -- Per set, not per row written: a unilateral set logged on both legs is two
  -- rows under one set number, and it is still the one set the plan prescribed.
  (SELECT COUNT(DISTINCT l.session_exercise_id || ':' || l.set_number)
     FROM set_log l WHERE l.session_id = s.id) AS logged_set_count,
  COALESCE(
    (SELECT MIN(e.at) FROM session_event e WHERE e.session_id = s.id AND e.kind = 'start'),
    (SELECT MIN(l.completed_at) FROM set_log l WHERE l.session_id = s.id)
  ) AS started_at,
  (SELECT e.at FROM session_event e
    WHERE e.session_id = s.id AND e.kind = 'complete'
      AND e.at > COALESCE(
        (SELECT MAX(u.at) FROM session_event u WHERE u.session_id = s.id AND u.kind = 'uncomplete'),
        '')
    ORDER BY e.at DESC LIMIT 1) AS marked_complete_at,
  (SELECT k.whoop_workout_id FROM session_workout_link k WHERE k.session_id = s.id) AS whoop_workout_id
FROM session s`;

function mapSession(row: SessionRow): Session {
  return {
    id: row.id,
    programId: row.program_id,
    weekId: row.week_id,
    scheduledDate: row.scheduled_date,
    orderIndex: row.order_index,
    dayType: row.day_type as DayType,
    blocksPresent: fromJson(row.blocks_present),
    prescribedSetCount: row.prescribed_set_count,
    dismissed: bool(row.dismissed),
    testStatus: oneOfOrNull(row.test_status, TEST_STATUSES),
    sorenessPre: row.soreness_pre,
    rpe: row.rpe,
    legsFeel: row.legs_feel,
    notes: row.notes,
    isMaximalCns: bool(row.is_maximal_cns),
    trimmedExercises: fromJson(row.trimmed_exercises),
    appliedModifications: fromJson(row.applied_modifications),
    shadowModifications: fromJson(row.shadow_modifications),
    snapshot: fromJson(row.snapshot),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
  scheduledDate: LocalDate,
  today: LocalDate,
): SessionStatus {
  if (markedCompleteAt !== null) return 'done';
  if (loggedSetCount > 0) return 'not_finished';
  return scheduledDate < today ? 'missed' : 'planned';
}

function mapDerived(row: DerivedRow, today: LocalDate): SessionWithStatus {
  return {
    ...mapSession(row),
    status: deriveStatus(row.logged_set_count, row.marked_complete_at, row.scheduled_date, today),
    loggedSetCount: row.logged_set_count,
    startedAt: row.started_at,
    markedCompleteAt: row.marked_complete_at,
    whoopWorkoutId: row.whoop_workout_id,
  };
}

function mapExercise(row: ExerciseRow): SessionExercise {
  return {
    id: row.id,
    sessionId: row.session_id,
    orderIndex: row.order_index,
    exerciseId: row.exercise_id,
    exerciseName: row.exercise_name,
    block: row.block,
    loadType: row.load_type,
    loadMode: oneOf(row.load_mode, LOAD_MODES, 'entered'),
    bothSides: bool(row.both_sides),
    rotationNote: row.rotation_note,
    headerNote: row.header_note,
    lastTimeNote: row.last_time_note,
    isNewThisWeek: bool(row.is_new_this_week),
    restS: row.rest_s,
    restRule: row.rest_rule,
    perSet: fromJson(row.per_set),
  };
}

/* ------------------------------------------------------------- creation */

export interface CreateSessionInput {
  readonly programId: string;
  readonly weekId: string;
  readonly scheduledDate: LocalDate;
  readonly orderIndex: number;
  readonly dayType: DayType;
  readonly blocksPresent?: Json;
  readonly testStatus?: TestStatus | null;
  readonly isMaximalCns?: boolean;
  readonly trimmedExercises?: Json;
  readonly snapshot?: Json;
  readonly exercises?: readonly CreateSessionExerciseInput[];
}

export interface CreateSessionExerciseInput {
  readonly exerciseId: string;
  readonly exerciseName: string;
  readonly orderIndex: number;
  readonly loadType: string;
  readonly loadMode?: SessionExercise['loadMode'];
  readonly block?: string | null;
  readonly bothSides?: boolean;
  readonly rotationNote?: string | null;
  readonly headerNote?: string | null;
  readonly lastTimeNote?: string | null;
  readonly isNewThisWeek?: boolean;
  readonly restS?: number | null;
  readonly restRule?: string | null;
  /** SetPrescription[] from the engine, stored verbatim. */
  readonly perSet: Json;
}

function countSets(perSet: Json): number {
  return Array.isArray(perSet) ? perSet.length : 0;
}

export async function createSession(db: SqlExecutor, input: CreateSessionInput): Promise<string> {
  const id = newId('sess');
  const at = nowIso();
  const exercises = input.exercises ?? [];
  const prescribed = exercises.reduce((total, item) => total + countSets(item.perSet), 0);

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO session
         (id, program_id, week_id, scheduled_date, order_index, day_type, blocks_present,
          prescribed_set_count, dismissed, test_status, is_maximal_cns, trimmed_exercises,
          snapshot, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.programId,
        input.weekId,
        input.scheduledDate,
        input.orderIndex,
        input.dayType,
        toJson(input.blocksPresent),
        prescribed,
        input.testStatus ?? null,
        intBool(input.isMaximalCns ?? false),
        toJson(input.trimmedExercises),
        toJson(input.snapshot),
        at,
        at,
      ],
    );
    for (const exercise of exercises) {
      await db.runAsync(
        `INSERT INTO session_exercise
           (id, session_id, order_index, exercise_id, exercise_name, block, load_type, load_mode,
            both_sides, rotation_note, header_note, last_time_note, is_new_this_week,
            rest_s, rest_rule, per_set)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId('sx'),
          id,
          exercise.orderIndex,
          exercise.exerciseId,
          exercise.exerciseName,
          exercise.block ?? null,
          exercise.loadType,
          exercise.loadMode ?? 'entered',
          intBool(exercise.bothSides ?? false),
          exercise.rotationNote ?? null,
          exercise.headerNote ?? null,
          exercise.lastTimeNote ?? null,
          intBool(exercise.isNewThisWeek ?? false),
          exercise.restS ?? null,
          exercise.restRule ?? null,
          toJsonRequired(exercise.perSet),
        ],
      );
    }
  });

  return id;
}

/* -------------------------------------------------------------- reading */

export async function listSessionsByWeek(
  db: SqlExecutor,
  weekId: string,
  today: LocalDate,
): Promise<SessionWithStatus[]> {
  const rows = await db.getAllAsync<DerivedRow>(
    `${DERIVED_SELECT} WHERE s.week_id = ? ORDER BY s.scheduled_date, s.order_index`,
    [weekId],
  );
  return rows.map((row) => mapDerived(row, today));
}

export async function getSession(
  db: SqlExecutor,
  sessionId: string,
  today: LocalDate,
): Promise<SessionWithStatus | null> {
  const row = await db.getFirstAsync<DerivedRow>(`${DERIVED_SELECT} WHERE s.id = ?`, [sessionId]);
  return row === null ? null : mapDerived(row, today);
}

export async function listSessionsByDate(
  db: SqlExecutor,
  date: LocalDate,
  today: LocalDate,
): Promise<SessionWithStatus[]> {
  const rows = await db.getAllAsync<DerivedRow>(
    `${DERIVED_SELECT} WHERE s.scheduled_date = ? ORDER BY s.order_index`,
    [date],
  );
  return rows.map((row) => mapDerived(row, today));
}

/** Sessions in a date range, for the Plan calendar and the missed-session card. */
export async function listSessionsBetween(
  db: SqlExecutor,
  from: LocalDate,
  to: LocalDate,
  today: LocalDate,
): Promise<SessionWithStatus[]> {
  const rows = await db.getAllAsync<DerivedRow>(
    `${DERIVED_SELECT} WHERE s.scheduled_date >= ? AND s.scheduled_date <= ?
     ORDER BY s.scheduled_date, s.order_index`,
    [from, to],
  );
  return rows.map((row) => mapDerived(row, today));
}

export async function listSessionExercises(
  db: SqlExecutor,
  sessionId: string,
): Promise<SessionExercise[]> {
  const rows = await db.getAllAsync<ExerciseRow>(
    'SELECT * FROM session_exercise WHERE session_id = ? ORDER BY order_index',
    [sessionId],
  );
  return rows.map(mapExercise);
}

/* -------------------------------------------------------------- writing */

export interface SessionPatch {
  readonly sorenessPre?: number | null;
  readonly rpe?: number | null;
  readonly legsFeel?: string | null;
  readonly notes?: string | null;
  readonly dismissed?: boolean;
  readonly testStatus?: TestStatus | null;
  readonly appliedModifications?: Json;
  readonly shadowModifications?: Json;
  readonly trimmedExercises?: Json;
}

export async function patchSession(
  db: SqlExecutor,
  sessionId: string,
  patch: SessionPatch,
): Promise<void> {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  const put = (column: string, value: string | number | null): void => {
    sets.push(`${column} = ?`);
    params.push(value);
  };

  if (patch.sorenessPre !== undefined) put('soreness_pre', patch.sorenessPre);
  if (patch.rpe !== undefined) put('rpe', patch.rpe);
  if (patch.legsFeel !== undefined) put('legs_feel', patch.legsFeel);
  if (patch.notes !== undefined) put('notes', patch.notes);
  if (patch.dismissed !== undefined) put('dismissed', intBool(patch.dismissed));
  if (patch.testStatus !== undefined) put('test_status', patch.testStatus);
  if (patch.appliedModifications !== undefined)
    put('applied_modifications', toJson(patch.appliedModifications));
  if (patch.shadowModifications !== undefined)
    put('shadow_modifications', toJson(patch.shadowModifications));
  if (patch.trimmedExercises !== undefined) put('trimmed_exercises', toJson(patch.trimmedExercises));

  if (sets.length === 0) return;
  put('updated_at', nowIso());
  params.push(sessionId);
  await db.runAsync(`UPDATE session SET ${sets.join(', ')} WHERE id = ?`, params);
}

async function addEvent(
  db: SqlExecutor,
  sessionId: string,
  kind: SessionEventKind,
  at: Timestamp,
): Promise<void> {
  await db.runAsync(
    'INSERT INTO session_event (id, session_id, kind, at, created_at) VALUES (?, ?, ?, ?, ?)',
    [newId('sev'), sessionId, kind, at, nowIso()],
  );
}

/** There is no Start button: the first row tap stamps the start, once. */
export async function markSessionStarted(
  db: SqlExecutor,
  sessionId: string,
  at: Timestamp = nowIso(),
): Promise<void> {
  const existing = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM session_event WHERE session_id = ? AND kind = 'start' LIMIT 1",
    [sessionId],
  );
  if (existing !== null) return;
  await addEvent(db, sessionId, 'start', at);
}

export async function markSessionComplete(
  db: SqlExecutor,
  sessionId: string,
  at: Timestamp = nowIso(),
): Promise<void> {
  await addEvent(db, sessionId, 'complete', at);
}

export async function undoSessionComplete(
  db: SqlExecutor,
  sessionId: string,
  at: Timestamp = nowIso(),
): Promise<void> {
  await addEvent(db, sessionId, 'uncomplete', at);
}

/* ------------------------------------------------------------ adherence */

/**
 * The inputs the engine's computeAdherence needs, read off the store: how many
 * sessions the week prescribed, how many are done, and whether every prescribed
 * set has a log. The calendar week is the adherence window (brief section 16).
 */
export async function weekAdherenceInputs(
  db: SqlExecutor,
  weekId: string,
  today: LocalDate,
): Promise<AdherenceInputs> {
  const week = await db.getFirstAsync<{ w: number; prescribed_count: number }>(
    'SELECT w, prescribed_count FROM week WHERE id = ?',
    [weekId],
  );
  const sessions = await listSessionsByWeek(db, weekId, today);
  const prescribedCount = week?.prescribed_count === undefined || week.prescribed_count === 0
    ? sessions.length
    : week.prescribed_count;
  const completedCount = sessions.filter((session) => session.status === 'done').length;
  const prescribedSets = sessions.reduce((total, session) => total + session.prescribedSetCount, 0);
  const loggedSets = sessions.reduce((total, session) => total + session.loggedSetCount, 0);

  return {
    weekId,
    w: week?.w ?? 0,
    prescribedCount,
    completedCount,
    adherencePct: prescribedCount === 0 ? 0 : (completedCount / prescribedCount) * 100,
    allRepsCompleted: prescribedSets > 0 && loggedSets >= prescribedSets,
    prescribedSets,
    loggedSets,
  };
}
