import type { SqlExecutor } from '../executor';
import type {
  EntrySource,
  Instrument,
  Json,
  JumpRep,
  JumpTestSession,
  JumpTestWithReps,
  LocalDate,
  MetricPr,
  Side,
  Timestamp,
} from '../types';
import { ATHLETE_ID } from './athlete';
import { bool, fromJson, intBool, newId, nowIso, oneOf, oneOfOrNull, toJson } from './rows';

const INSTRUMENTS: readonly Instrument[] = [
  'ovr_jump_regular',
  'ovr_jump_rsi',
  'vertec_reach_touch',
  'manual',
];

const SIDES: readonly Side[] = ['left', 'right'];

/** 1.0 in, the asserted default, recalibrated from the athlete's own spread. */
export const DEFAULT_PR_THRESHOLD_MM = 25;

/** The first three sessions on a new instrument calibrate: no PR moment. */
export const CALIBRATION_SESSIONS = 3;

interface TestRow {
  readonly id: string;
  readonly athlete_id: string;
  readonly session_id: string | null;
  readonly local_date: string;
  readonly performed_at: string;
  readonly instrument: string;
  readonly mode: string;
  readonly unit_preference: string;
  readonly box_height_mm: number | null;
  readonly device_firmware: string | null;
  readonly connect_version: string | null;
  readonly is_baseline: number;
  readonly canonical: number;
  readonly scheduled: number;
  readonly bodyweight_kg: number | null;
  readonly whoop_snapshot: string | null;
  readonly notes: string | null;
  readonly import_batch_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface RepRow {
  readonly id: string;
  readonly jump_test_session_id: string;
  readonly attempt_index: number;
  readonly height_mm: number | null;
  readonly gct_ms: number | null;
  readonly rsi_calc: number | null;
  readonly rsi_device: number | null;
  readonly side: string | null;
  readonly flagged: number;
  readonly reject_reason: string | null;
  readonly entry_source: string;
  readonly import_batch_id: string | null;
  readonly created_at: string;
}

interface PrRow {
  readonly id: string;
  readonly instrument: string;
  readonly mode: string;
  readonly value_mm: number;
  readonly jump_test_session_id: string;
  readonly local_date: string;
  readonly threshold_used_mm: number;
  readonly previous_value_mm: number | null;
  readonly computed_at: string;
}

function mapTest(row: TestRow): JumpTestSession {
  return {
    id: row.id,
    athleteId: row.athlete_id,
    sessionId: row.session_id,
    localDate: row.local_date,
    performedAt: row.performed_at,
    instrument: oneOf(row.instrument, INSTRUMENTS, 'manual'),
    mode: row.mode,
    unitPreference: row.unit_preference,
    boxHeightMm: row.box_height_mm,
    deviceFirmware: row.device_firmware,
    connectVersion: row.connect_version,
    isBaseline: bool(row.is_baseline),
    canonical: bool(row.canonical),
    scheduled: bool(row.scheduled),
    bodyweightKg: row.bodyweight_kg,
    whoopSnapshot: fromJson(row.whoop_snapshot),
    notes: row.notes,
    importBatchId: row.import_batch_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRep(row: RepRow): JumpRep {
  return {
    id: row.id,
    jumpTestSessionId: row.jump_test_session_id,
    attemptIndex: row.attempt_index,
    heightMm: row.height_mm,
    gctMs: row.gct_ms,
    rsiCalc: row.rsi_calc,
    rsiDevice: row.rsi_device,
    side: oneOfOrNull(row.side, SIDES),
    flagged: bool(row.flagged),
    rejectReason: row.reject_reason,
    entrySource: oneOf(row.entry_source, ['typed', 'imported', 'estimated'] as const, 'typed'),
    importBatchId: row.import_batch_id,
    createdAt: row.created_at,
  };
}

function mapPr(row: PrRow): MetricPr {
  return {
    id: row.id,
    instrument: oneOf(row.instrument, INSTRUMENTS, 'manual'),
    mode: row.mode,
    valueMm: row.value_mm,
    jumpTestSessionId: row.jump_test_session_id,
    localDate: row.local_date,
    thresholdUsedMm: row.threshold_used_mm,
    previousValueMm: row.previous_value_mm,
    computedAt: row.computed_at,
  };
}

function summarise(
  test: JumpTestSession,
  reps: readonly JumpRep[],
  prSessionIds: ReadonlySet<string>,
): JumpTestWithReps {
  const heights = reps
    .filter((rep) => !rep.flagged && rep.heightMm !== null)
    .map((rep) => rep.heightMm as number);
  const best = heights.length === 0 ? null : Math.max(...heights);
  const spread = heights.length < 2 ? null : Math.max(...heights) - Math.min(...heights);
  return { ...test, reps, bestHeightMm: best, spreadMm: spread, isPr: prSessionIds.has(test.id) };
}

/* -------------------------------------------------------------- writing */

export interface JumpAttemptInput {
  readonly attemptIndex: number;
  readonly heightMm?: number | null;
  readonly gctMs?: number | null;
  readonly rsiCalc?: number | null;
  readonly rsiDevice?: number | null;
  /** House `house.sc.asymmetry_tracking`: which leg this attempt was on. */
  readonly side?: Side | null;
  readonly flagged?: boolean;
  readonly rejectReason?: string | null;
  readonly entrySource?: EntrySource;
  readonly importBatchId?: string | null;
}

export interface CreateJumpTestInput {
  readonly localDate: LocalDate;
  readonly performedAt?: Timestamp;
  readonly instrument: Instrument;
  readonly mode?: string;
  readonly unitPreference?: string;
  readonly sessionId?: string | null;
  readonly boxHeightMm?: number | null;
  readonly deviceFirmware?: string | null;
  readonly connectVersion?: string | null;
  readonly isBaseline?: boolean;
  readonly canonical?: boolean;
  readonly scheduled?: boolean;
  readonly bodyweightKg?: number | null;
  readonly whoopSnapshot?: Json;
  readonly notes?: string | null;
  readonly importBatchId?: string | null;
  readonly attempts: readonly JumpAttemptInput[];
}

export async function createJumpTest(
  db: SqlExecutor,
  input: CreateJumpTestInput,
): Promise<JumpTestWithReps> {
  const id = newId('jts');
  const at = nowIso();
  const mode = input.mode ?? (input.instrument === 'ovr_jump_rsi' ? 'rsi' : 'cmj');

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO jump_test_session
         (id, athlete_id, session_id, local_date, performed_at, instrument, mode, unit_preference,
          box_height_mm, device_firmware, connect_version, is_baseline, canonical, scheduled,
          bodyweight_kg, whoop_snapshot, notes, import_batch_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        ATHLETE_ID,
        input.sessionId ?? null,
        input.localDate,
        input.performedAt ?? at,
        input.instrument,
        mode,
        input.unitPreference ?? 'in',
        input.boxHeightMm ?? null,
        input.deviceFirmware ?? null,
        input.connectVersion ?? null,
        intBool(input.isBaseline ?? false),
        intBool(input.canonical ?? true),
        intBool(input.scheduled ?? true),
        input.bodyweightKg ?? null,
        toJson(input.whoopSnapshot),
        input.notes ?? null,
        input.importBatchId ?? null,
        at,
        at,
      ],
    );
    for (const attempt of input.attempts) {
      await db.runAsync(
        `INSERT INTO jump_rep
           (id, jump_test_session_id, attempt_index, height_mm, gct_ms, rsi_calc, rsi_device,
            side, flagged, reject_reason, entry_source, import_batch_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT DO NOTHING`,
        [
          newId('jrep'),
          id,
          attempt.attemptIndex,
          attempt.heightMm ?? null,
          attempt.gctMs ?? null,
          attempt.rsiCalc ?? null,
          attempt.rsiDevice ?? null,
          attempt.side ?? null,
          intBool(attempt.flagged ?? false),
          attempt.rejectReason ?? null,
          attempt.entrySource ?? 'typed',
          attempt.importBatchId ?? null,
          at,
        ],
      );
    }
  });

  await recomputePrs(db, input.instrument, mode);
  const saved = await getJumpTest(db, id);
  if (saved === null) throw new Error('createJumpTest: the test did not save.');
  return saved;
}

/** Deleting a test recomputes the stream, so a removed PR does not linger. */
export async function deleteJumpTest(db: SqlExecutor, testId: string): Promise<void> {
  const test = await db.getFirstAsync<TestRow>('SELECT * FROM jump_test_session WHERE id = ?', [
    testId,
  ]);
  if (test === null) return;
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM jump_rep WHERE jump_test_session_id = ?', [testId]);
    await db.runAsync('DELETE FROM jump_test_session WHERE id = ?', [testId]);
  });
  await recomputePrs(db, oneOf(test.instrument, INSTRUMENTS, 'manual'), test.mode);
}

/* -------------------------------------------------------------- reading */

async function loadPrSessionIds(
  db: SqlExecutor,
  instrument?: Instrument,
  mode?: string,
): Promise<Set<string>> {
  const rows =
    instrument === undefined
      ? await db.getAllAsync<{ jump_test_session_id: string }>(
          'SELECT jump_test_session_id FROM metric_pr',
        )
      : await db.getAllAsync<{ jump_test_session_id: string }>(
          'SELECT jump_test_session_id FROM metric_pr WHERE instrument = ? AND mode = ?',
          [instrument, mode ?? 'cmj'],
        );
  return new Set(rows.map((row) => row.jump_test_session_id));
}

async function loadReps(db: SqlExecutor, testIds: readonly string[]): Promise<Map<string, JumpRep[]>> {
  const byTest = new Map<string, JumpRep[]>();
  if (testIds.length === 0) return byTest;
  const placeholders = testIds.map(() => '?').join(', ');
  const rows = await db.getAllAsync<RepRow>(
    `SELECT * FROM jump_rep WHERE jump_test_session_id IN (${placeholders}) ORDER BY attempt_index`,
    [...testIds],
  );
  for (const row of rows) {
    const list = byTest.get(row.jump_test_session_id) ?? [];
    list.push(mapRep(row));
    byTest.set(row.jump_test_session_id, list);
  }
  return byTest;
}

export async function getJumpTest(db: SqlExecutor, testId: string): Promise<JumpTestWithReps | null> {
  const row = await db.getFirstAsync<TestRow>('SELECT * FROM jump_test_session WHERE id = ?', [testId]);
  if (row === null) return null;
  const reps = (await loadReps(db, [testId])).get(testId) ?? [];
  const prs = await loadPrSessionIds(db);
  return summarise(mapTest(row), reps, prs);
}

export interface ListJumpTestsOptions {
  readonly instrument?: Instrument;
  readonly mode?: string;
  readonly canonicalOnly?: boolean;
  readonly limit?: number;
}

/** One instrument stream, oldest first. Streams never share a trend or a PR. */
export async function listJumpTests(
  db: SqlExecutor,
  options: ListJumpTestsOptions = {},
): Promise<JumpTestWithReps[]> {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (options.instrument !== undefined) {
    clauses.push('instrument = ?');
    params.push(options.instrument);
  }
  if (options.mode !== undefined) {
    clauses.push('mode = ?');
    params.push(options.mode);
  }
  if (options.canonicalOnly === true) clauses.push('canonical = 1');
  const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`;
  const limit = options.limit === undefined ? '' : ` LIMIT ${Math.max(1, Math.floor(options.limit))}`;

  const rows = await db.getAllAsync<TestRow>(
    `SELECT * FROM jump_test_session ${where} ORDER BY local_date, performed_at${limit}`,
    params,
  );
  const reps = await loadReps(db, rows.map((row) => row.id));
  const prs = await loadPrSessionIds(db);
  return rows.map((row) => summarise(mapTest(row), reps.get(row.id) ?? [], prs));
}

export async function listPrs(
  db: SqlExecutor,
  instrument: Instrument,
  mode = 'cmj',
): Promise<MetricPr[]> {
  const rows = await db.getAllAsync<PrRow>(
    'SELECT * FROM metric_pr WHERE instrument = ? AND mode = ? ORDER BY local_date',
    [instrument, mode],
  );
  return rows.map(mapPr);
}

export async function getCurrentBest(
  db: SqlExecutor,
  instrument: Instrument,
  mode = 'cmj',
): Promise<number | null> {
  const tests = await listJumpTests(db, { instrument, mode, canonicalOnly: true });
  const bests = tests.map((test) => test.bestHeightMm).filter((value): value is number => value !== null);
  return bests.length === 0 ? null : Math.max(...bests);
}

/* --------------------------------------------------------- PR recompute */

/**
 * Rebuild metric_pr for one stream from the tests themselves.
 *
 * A PR needs a same-instrument, same-mode canonical test that beats the running
 * best by at least the threshold, and the first three sessions on a stream are
 * calibration: they set the best without ever showing a PR. The table is a
 * cache, so this is safe to run after every write and after any delete.
 */
export async function recomputePrs(
  db: SqlExecutor,
  instrument: Instrument,
  mode = 'cmj',
  thresholdMm: number = DEFAULT_PR_THRESHOLD_MM,
): Promise<MetricPr[]> {
  const tests = await listJumpTests(db, { instrument, mode, canonicalOnly: true });
  const at = nowIso();

  const prs: Omit<MetricPr, 'id'>[] = [];
  let best: number | null = null;
  let index = 0;

  for (const test of tests) {
    const value = test.bestHeightMm;
    index += 1;
    if (value === null) continue;
    const calibrating = index <= CALIBRATION_SESSIONS;
    if (!calibrating && best !== null && value >= best + thresholdMm) {
      prs.push({
        instrument,
        mode,
        valueMm: value,
        jumpTestSessionId: test.id,
        localDate: test.localDate,
        thresholdUsedMm: thresholdMm,
        previousValueMm: best,
        computedAt: at,
      });
    }
    if (best === null || value > best) best = value;
  }

  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM metric_pr WHERE instrument = ? AND mode = ?', [instrument, mode]);
    for (const pr of prs) {
      await db.runAsync(
        `INSERT INTO metric_pr
           (id, instrument, mode, value_mm, jump_test_session_id, local_date,
            threshold_used_mm, previous_value_mm, computed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId('pr'),
          pr.instrument,
          pr.mode,
          pr.valueMm,
          pr.jumpTestSessionId,
          pr.localDate,
          pr.thresholdUsedMm,
          pr.previousValueMm,
          pr.computedAt,
        ],
      );
    }
  });

  return listPrs(db, instrument, mode);
}
