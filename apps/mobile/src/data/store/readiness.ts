import { asymmetryPct, weakerSideFrom } from '@vert/engine/analytics';
import { mmToIn } from '@vert/engine/units';
import type { SqlExecutor } from '../executor';
import type {
  EntrySource,
  Instrument,
  Json,
  LocalDate,
  ReadinessMetric,
  ReadinessOutcome,
  ReadinessState,
  ReadinessTestKind,
  ReadinessTestSession,
  SessionAnswer,
  SessionAnswerKind,
  Side,
  SingleLegTest,
  Timestamp,
} from '../types';
import { ATHLETE_ID } from './athlete';
import { fromJson, fromJsonArray, newId, nowIso, oneOf, oneOfOrNull, toJson } from './rows';

/**
 * The three streams the climbing house rules read.
 *
 * `readiness_test_session` is channel B of the readiness gate: one row a day
 * at most, because the gate scores the day's best attempt against the rolling
 * median of the days before it (`house.sc.readiness_gate`).
 *
 * `readiness_outcome` records what the gate did to one session, so an
 * adjustment is auditable and can be undone by changing the answer rather than
 * by guessing what was applied.
 *
 * `session_answer` is the 0 to 10 finger question, keyed by day rather than by
 * session: the answer is about the fingers, not about a workout, and two
 * sessions on one day read the same answer (`house.sc.finger_pain_ceiling`).
 *
 * Single-leg tests are not a table of their own. They are `jump_test_session`
 * rows in mode 'single_leg' whose reps carry a side, so they never leak into a
 * stream, a trend, or a PR (`house.sc.asymmetry_tracking`).
 */

const KINDS: readonly ReadinessTestKind[] = ['seated_mb_throw', 'cmj', 'rsi'];
const METRICS: readonly ReadinessMetric[] = ['distance_m', 'height_in', 'rsi'];
const STATES: readonly ReadinessState[] = [
  'both_high',
  'autonomic_low',
  'neuromuscular_low',
  'both_low',
  'unknown',
];
const SOURCES: readonly EntrySource[] = ['typed', 'imported', 'estimated'];
const ANSWER_KINDS: readonly SessionAnswerKind[] = ['finger_pain'];
const SIDES: readonly Side[] = ['left', 'right'];

/** The jump-test mode a single-leg pair is filed under. Never canonical. */
export const SINGLE_LEG_MODE = 'single_leg';

/** Inside this many percent the legs read as level, so noise names no side. */
export const DEFAULT_ASYMMETRY_BAND_PCT = 3;

/* ------------------------------------------------------- readiness tests */

interface TestRow {
  readonly id: string;
  readonly athlete_id: string;
  readonly local_date: string;
  readonly kind: string;
  readonly metric: string;
  readonly attempts_json: string;
  readonly best: number | null;
  readonly unit: string;
  readonly whoop_recovery_snapshot: string | null;
  readonly entry_source: string;
  readonly created_at: string;
}

function mapTest(row: TestRow): ReadinessTestSession {
  return {
    id: row.id,
    athleteId: row.athlete_id,
    localDate: row.local_date,
    kind: oneOf(row.kind, KINDS, 'seated_mb_throw'),
    metric: oneOf(row.metric, METRICS, 'distance_m'),
    attempts: fromJsonArray<number>(row.attempts_json),
    best: row.best,
    unit: row.unit,
    whoopRecoverySnapshot: fromJson(row.whoop_recovery_snapshot),
    entrySource: oneOf(row.entry_source, SOURCES, 'typed'),
    createdAt: row.created_at,
  };
}

export interface CreateReadinessTestInput {
  readonly localDate: LocalDate;
  readonly kind: ReadinessTestKind;
  readonly metric: ReadinessMetric;
  readonly attempts: readonly number[];
  readonly unit: string;
  readonly best?: number | null;
  readonly whoopRecoverySnapshot?: Json;
  readonly entrySource?: EntrySource;
  readonly createdAt?: Timestamp;
}

/** The day's number is the best attempt, so it is derived, never typed twice. */
export function bestAttempt(attempts: readonly number[]): number | null {
  const usable = attempts.filter((value) => Number.isFinite(value));
  return usable.length === 0 ? null : Math.max(...usable);
}

/**
 * One test a day, per kind: a second run replaces the first rather than
 * doubling the day's weight in the rolling median.
 */
export async function createReadinessTest(
  db: SqlExecutor,
  input: CreateReadinessTestInput,
): Promise<ReadinessTestSession> {
  const at = input.createdAt ?? nowIso();
  const best = input.best ?? bestAttempt(input.attempts);
  const existing = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM readiness_test_session WHERE athlete_id = ? AND kind = ? AND local_date = ?',
    [ATHLETE_ID, input.kind, input.localDate],
  );
  const id = existing?.id ?? newId('rt');
  await db.runAsync(
    `INSERT INTO readiness_test_session
       (id, athlete_id, local_date, kind, metric, attempts_json, best, unit,
        whoop_recovery_snapshot, entry_source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       metric = excluded.metric,
       attempts_json = excluded.attempts_json,
       best = excluded.best,
       unit = excluded.unit,
       whoop_recovery_snapshot = excluded.whoop_recovery_snapshot,
       entry_source = excluded.entry_source`,
    [
      id,
      ATHLETE_ID,
      input.localDate,
      input.kind,
      input.metric,
      toJson([...input.attempts]) ?? '[]',
      best,
      input.unit,
      toJson(input.whoopRecoverySnapshot),
      input.entrySource ?? 'typed',
      at,
    ],
  );
  const saved = await db.getFirstAsync<TestRow>(
    'SELECT * FROM readiness_test_session WHERE id = ?',
    [id],
  );
  if (saved === null) throw new Error('createReadinessTest: the test did not save.');
  return mapTest(saved);
}

export interface ListReadinessTestsOptions {
  readonly kind?: ReadinessTestKind;
  readonly onOrBefore?: LocalDate;
  readonly limit?: number;
}

/** One kind's stream, oldest first, so the median window slices off the end. */
export async function listReadinessTests(
  db: SqlExecutor,
  options: ListReadinessTestsOptions = {},
): Promise<ReadinessTestSession[]> {
  const clauses = ['athlete_id = ?'];
  const params: (string | number)[] = [ATHLETE_ID];
  if (options.kind !== undefined) {
    clauses.push('kind = ?');
    params.push(options.kind);
  }
  if (options.onOrBefore !== undefined) {
    clauses.push('local_date <= ?');
    params.push(options.onOrBefore);
  }
  const limit =
    options.limit === undefined ? '' : ` LIMIT ${Math.max(1, Math.floor(options.limit))}`;
  const rows = await db.getAllAsync<TestRow>(
    `SELECT * FROM readiness_test_session WHERE ${clauses.join(' AND ')}
     ORDER BY local_date, created_at${limit}`,
    params,
  );
  return rows.map(mapTest);
}

/** The day's test, or null when nothing was logged. */
export async function getReadinessTestForDay(
  db: SqlExecutor,
  date: LocalDate,
  kind?: ReadinessTestKind,
): Promise<ReadinessTestSession | null> {
  const rows = await listReadinessTests(db, { ...(kind === undefined ? null : { kind }) });
  return rows.find((row) => row.localDate === date) ?? null;
}

export async function deleteReadinessTest(db: SqlExecutor, testId: string): Promise<void> {
  await db.runAsync('DELETE FROM readiness_test_session WHERE id = ?', [testId]);
}

/* ---------------------------------------------------- readiness outcomes */

interface OutcomeRow {
  readonly session_id: string;
  readonly local_date: string;
  readonly state: string;
  readonly channels_json: string;
  readonly adjustment_json: string;
  readonly line: string;
  readonly house_rule_id: string | null;
  readonly applied_at: string | null;
}

function mapOutcome(row: OutcomeRow): ReadinessOutcome {
  return {
    sessionId: row.session_id,
    localDate: row.local_date,
    state: oneOf(row.state, STATES, 'unknown'),
    channels: fromJson(row.channels_json),
    adjustment: fromJson(row.adjustment_json),
    line: row.line,
    houseRuleId: row.house_rule_id,
    appliedAt: row.applied_at,
  };
}

export interface SetReadinessOutcomeInput {
  readonly sessionId: string;
  readonly localDate: LocalDate;
  readonly state: ReadinessState;
  readonly channels: Json;
  readonly adjustment: Json;
  readonly line: string;
  readonly houseRuleId?: string | null;
  readonly appliedAt?: Timestamp | null;
}

/** One outcome per session: today's answer replaces today's answer. */
export async function setReadinessOutcome(
  db: SqlExecutor,
  input: SetReadinessOutcomeInput,
): Promise<ReadinessOutcome> {
  await db.runAsync(
    `INSERT INTO readiness_outcome
       (session_id, local_date, state, channels_json, adjustment_json, line, house_rule_id, applied_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       local_date = excluded.local_date,
       state = excluded.state,
       channels_json = excluded.channels_json,
       adjustment_json = excluded.adjustment_json,
       line = excluded.line,
       house_rule_id = excluded.house_rule_id,
       applied_at = excluded.applied_at`,
    [
      input.sessionId,
      input.localDate,
      input.state,
      toJson(input.channels) ?? 'null',
      toJson(input.adjustment) ?? 'null',
      input.line,
      input.houseRuleId ?? null,
      input.appliedAt ?? nowIso(),
    ],
  );
  const saved = await getReadinessOutcome(db, input.sessionId);
  if (saved === null) throw new Error('setReadinessOutcome: the outcome did not save.');
  return saved;
}

export async function getReadinessOutcome(
  db: SqlExecutor,
  sessionId: string,
): Promise<ReadinessOutcome | null> {
  const row = await db.getFirstAsync<OutcomeRow>(
    'SELECT * FROM readiness_outcome WHERE session_id = ?',
    [sessionId],
  );
  return row === null ? null : mapOutcome(row);
}

export async function clearReadinessOutcome(db: SqlExecutor, sessionId: string): Promise<void> {
  await db.runAsync('DELETE FROM readiness_outcome WHERE session_id = ?', [sessionId]);
}

/* ------------------------------------------------------ session answers */

interface AnswerRow {
  readonly id: string;
  readonly athlete_id: string;
  readonly session_id: string | null;
  readonly local_date: string;
  readonly kind: string;
  readonly value: number | null;
  readonly note: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

function mapAnswer(row: AnswerRow): SessionAnswer {
  return {
    id: row.id,
    athleteId: row.athlete_id,
    sessionId: row.session_id,
    localDate: row.local_date,
    kind: oneOf(row.kind, ANSWER_KINDS, 'finger_pain'),
    value: row.value,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface SetSessionAnswerInput {
  readonly localDate: LocalDate;
  readonly kind: SessionAnswerKind;
  readonly value: number | null;
  readonly sessionId?: string | null;
  readonly note?: string | null;
}

/** One answer per day per question. Re-answering moves the same row. */
export async function setSessionAnswer(
  db: SqlExecutor,
  input: SetSessionAnswerInput,
): Promise<SessionAnswer> {
  const at = nowIso();
  const existing = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM session_answer WHERE athlete_id = ? AND local_date = ? AND kind = ?',
    [ATHLETE_ID, input.localDate, input.kind],
  );
  const id = existing?.id ?? newId('ans');
  await db.runAsync(
    `INSERT INTO session_answer
       (id, athlete_id, session_id, local_date, kind, value, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       session_id = excluded.session_id,
       value = excluded.value,
       note = excluded.note,
       updated_at = excluded.updated_at`,
    [
      id,
      ATHLETE_ID,
      input.sessionId ?? null,
      input.localDate,
      input.kind,
      input.value,
      input.note ?? null,
      at,
      at,
    ],
  );
  const saved = await db.getFirstAsync<AnswerRow>('SELECT * FROM session_answer WHERE id = ?', [id]);
  if (saved === null) throw new Error('setSessionAnswer: the answer did not save.');
  return mapAnswer(saved);
}

export async function getSessionAnswer(
  db: SqlExecutor,
  date: LocalDate,
  kind: SessionAnswerKind = 'finger_pain',
): Promise<SessionAnswer | null> {
  const row = await db.getFirstAsync<AnswerRow>(
    'SELECT * FROM session_answer WHERE athlete_id = ? AND local_date = ? AND kind = ?',
    [ATHLETE_ID, date, kind],
  );
  return row === null ? null : mapAnswer(row);
}

/** The answered days, oldest first, so a screen can show the last fortnight. */
export async function listSessionAnswers(
  db: SqlExecutor,
  kind: SessionAnswerKind = 'finger_pain',
  from?: LocalDate,
  to?: LocalDate,
): Promise<SessionAnswer[]> {
  const clauses = ['athlete_id = ?', 'kind = ?'];
  const params: (string | number)[] = [ATHLETE_ID, kind];
  if (from !== undefined) {
    clauses.push('local_date >= ?');
    params.push(from);
  }
  if (to !== undefined) {
    clauses.push('local_date <= ?');
    params.push(to);
  }
  const rows = await db.getAllAsync<AnswerRow>(
    `SELECT * FROM session_answer WHERE ${clauses.join(' AND ')} ORDER BY local_date`,
    params,
  );
  return rows.map(mapAnswer);
}

/* ------------------------------------------------------ single-leg tests */

interface SingleLegRow {
  readonly id: string;
  readonly local_date: string;
  readonly instrument: string;
  readonly side: string | null;
  readonly height_mm: number | null;
  readonly flagged: number;
}

const INSTRUMENTS: readonly Instrument[] = [
  'ovr_jump_regular',
  'ovr_jump_rsi',
  'vertec_reach_touch',
  'manual',
];

/**
 * Every single-leg test, oldest first, as the engine's `SingleLegTest`.
 *
 * The best unflagged attempt per side is the side's number, and the gap is
 * recomputed from the two heights through the engine rather than stored, so a
 * corrected rep changes the gap the ordering reads.
 */
export async function listSingleLegTests(
  db: SqlExecutor,
  bandPct: number = DEFAULT_ASYMMETRY_BAND_PCT,
): Promise<SingleLegTest[]> {
  const rows = await db.getAllAsync<SingleLegRow>(
    `SELECT t.id AS id, t.local_date AS local_date, t.instrument AS instrument,
            r.side AS side, r.height_mm AS height_mm, r.flagged AS flagged
       FROM jump_test_session t
       JOIN jump_rep r ON r.jump_test_session_id = t.id
      WHERE t.athlete_id = ? AND t.mode = ?
      ORDER BY t.local_date, t.performed_at, r.attempt_index`,
    [ATHLETE_ID, SINGLE_LEG_MODE],
  );

  const byTest = new Map<string, { date: string; instrument: string; left: number; right: number }>();
  for (const row of rows) {
    if (row.flagged === 1 || row.height_mm === null) continue;
    const side = oneOfOrNull(row.side, SIDES);
    if (side === null) continue;
    const entry = byTest.get(row.id) ?? {
      date: row.local_date,
      instrument: row.instrument,
      left: 0,
      right: 0,
    };
    const inches = mmToIn(row.height_mm);
    if (side === 'left') entry.left = Math.max(entry.left, inches);
    else entry.right = Math.max(entry.right, inches);
    byTest.set(row.id, entry);
  }

  const out: SingleLegTest[] = [];
  for (const [id, entry] of byTest) {
    if (entry.left <= 0 || entry.right <= 0) continue;
    const pct = asymmetryPct(entry.left, entry.right);
    out.push({
      id,
      localDate: entry.date,
      instrument: oneOf(entry.instrument, INSTRUMENTS, 'manual'),
      leftIn: entry.left,
      rightIn: entry.right,
      asymmetryPct: pct,
      weakerSide: Math.abs(pct) <= bandPct ? null : pct > 0 ? 'right' : 'left',
    });
  }
  return out;
}

/**
 * Which leg goes first (`house.sc.weaker_side_first`): the latest test's
 * weaker side, or the athlete's own answer when no test decides it.
 */
export async function readWeakerSide(
  db: SqlExecutor,
  answer: Side | null,
  bandPct: number = DEFAULT_ASYMMETRY_BAND_PCT,
): Promise<Side | null> {
  const tests = await listSingleLegTests(db, bandPct);
  return weakerSideFrom(
    tests.map((test) => ({
      date: test.localDate,
      instrument: test.instrument,
      leftIn: test.leftIn,
      rightIn: test.rightIn,
      asymmetryPct: test.asymmetryPct,
      weakerSide: test.weakerSide,
    })),
    answer,
    bandPct,
  );
}
