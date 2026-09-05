import type { SqlExecutor } from '../executor';
import type {
  Block,
  Json,
  LocalDate,
  Program,
  ProgramVersion,
  Timestamp,
  Week,
  WeekKind,
  WeekOutcome,
} from '../types';
import { ATHLETE_ID } from './athlete';
import {
  boolOrNull,
  fromJson,
  intBool,
  newId,
  nowIso,
  oneOf,
  oneOfOrNull,
  toJson,
  toJsonRequired,
} from './rows';

const WEEK_KINDS: readonly WeekKind[] = ['load', 'deload', 'taper', 'peak'];
const OUTCOMES: readonly WeekOutcome[] = ['progress', 'small', 'hold', 'repeat'];

interface ProgramRow {
  readonly id: string;
  readonly athlete_id: string;
  readonly macro_index: number;
  readonly parent_program_id: string | null;
  readonly ruleset_version: string;
  readonly seed: string;
  readonly start_date: string;
  readonly end_date: string;
  readonly status: string;
  readonly snapshot: string;
  readonly validation_report: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface WeekRow {
  readonly id: string;
  readonly program_id: string;
  readonly program_version_id: string | null;
  readonly block_id: string | null;
  readonly w: number;
  readonly window_start: string;
  readonly window_end: string;
  readonly kind: string;
  readonly k: number | null;
  readonly prescribed_count: number;
  readonly completed_count: number;
  readonly adherence_pct: number | null;
  readonly all_reps_completed: number | null;
  readonly outcome: string | null;
  readonly generated_at: string | null;
  readonly generated_by: string | null;
  readonly repeat_of_week: number | null;
  readonly joint_high_stress_counts: string | null;
  readonly high_contact_allowance: number | null;
  readonly extensive_target: number | null;
  readonly ladder_rungs: string | null;
  readonly snapshot: string | null;
}

interface BlockRow {
  readonly id: string;
  readonly program_id: string;
  readonly type: string;
  readonly order_index: number;
  readonly week_start: number;
  readonly week_end: number;
}

interface VersionRow {
  readonly id: string;
  readonly program_id: string;
  readonly version: number;
  readonly week_layout: string;
  readonly reason: string | null;
  readonly created_at: string;
}

function mapProgram(row: ProgramRow): Program {
  return {
    id: row.id,
    athleteId: row.athlete_id,
    macroIndex: row.macro_index,
    parentProgramId: row.parent_program_id,
    rulesetVersion: row.ruleset_version,
    seed: row.seed,
    startDate: row.start_date,
    endDate: row.end_date,
    status: oneOf(row.status, ['active', 'complete', 'superseded'] as const, 'active'),
    snapshot: fromJson(row.snapshot),
    validationReport: fromJson(row.validation_report),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapWeek(row: WeekRow): Week {
  return {
    id: row.id,
    programId: row.program_id,
    programVersionId: row.program_version_id,
    blockId: row.block_id,
    w: row.w,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    kind: oneOf(row.kind, WEEK_KINDS, 'load'),
    k: row.k,
    prescribedCount: row.prescribed_count,
    completedCount: row.completed_count,
    adherencePct: row.adherence_pct,
    allRepsCompleted: boolOrNull(row.all_reps_completed),
    outcome: oneOfOrNull(row.outcome, OUTCOMES),
    generatedAt: row.generated_at,
    generatedBy: row.generated_by,
    repeatOfWeek: row.repeat_of_week,
    jointHighStressCounts: fromJson(row.joint_high_stress_counts),
    highContactAllowance: row.high_contact_allowance,
    extensiveTarget: row.extensive_target,
    ladderRungs: fromJson(row.ladder_rungs),
    snapshot: fromJson(row.snapshot),
  };
}

function mapBlock(row: BlockRow): Block {
  return {
    id: row.id,
    programId: row.program_id,
    type: row.type,
    orderIndex: row.order_index,
    weekStart: row.week_start,
    weekEnd: row.week_end,
  };
}

function mapVersion(row: VersionRow): ProgramVersion {
  return {
    id: row.id,
    programId: row.program_id,
    version: row.version,
    weekLayout: fromJson(row.week_layout),
    reason: row.reason,
    createdAt: row.created_at,
  };
}

/* -------------------------------------------------------------- programs */

export interface CreateProgramInput {
  readonly rulesetVersion: string;
  readonly seed: string;
  readonly startDate: LocalDate;
  readonly endDate: LocalDate;
  readonly snapshot: Json;
  readonly macroIndex?: number;
  readonly parentProgramId?: string | null;
  readonly validationReport?: Json;
  readonly weekLayout: Json;
  readonly reason?: string;
  readonly blocks?: readonly Omit<Block, 'id' | 'programId'>[];
}

export interface CreatedProgram {
  readonly program: Program;
  readonly version: ProgramVersion;
}

/**
 * A program is always created with version 1: the Plan summary and every
 * regeneration read the layout from a version row, never from the program.
 * Creating one supersedes whatever was active, because there is one athlete.
 */
export async function createProgram(
  db: SqlExecutor,
  input: CreateProgramInput,
): Promise<CreatedProgram> {
  const programId = newId('prog');
  const versionId = newId('pver');
  const at = nowIso();

  await db.withTransactionAsync(async () => {
    await db.runAsync("UPDATE program SET status = 'superseded', updated_at = ? WHERE status = 'active'", [at]);
    await db.runAsync(
      `INSERT INTO program
         (id, athlete_id, macro_index, parent_program_id, ruleset_version, seed,
          start_date, end_date, status, snapshot, validation_report, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      [
        programId,
        ATHLETE_ID,
        input.macroIndex ?? 1,
        input.parentProgramId ?? null,
        input.rulesetVersion,
        input.seed,
        input.startDate,
        input.endDate,
        toJsonRequired(input.snapshot),
        toJson(input.validationReport),
        at,
        at,
      ],
    );
    await db.runAsync(
      `INSERT INTO program_version (id, program_id, version, week_layout, reason, created_at)
       VALUES (?, ?, 1, ?, ?, ?)`,
      [versionId, programId, toJsonRequired(input.weekLayout), input.reason ?? 'first build', at],
    );
    for (const block of input.blocks ?? []) {
      await db.runAsync(
        `INSERT INTO block (id, program_id, type, order_index, week_start, week_end)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [newId('blk'), programId, block.type, block.orderIndex, block.weekStart, block.weekEnd],
      );
    }
  });

  const program = await getProgram(db, programId);
  const version = await getProgramVersion(db, versionId);
  if (program === null || version === null) throw new Error('createProgram: the program did not save.');
  return { program, version };
}

/** A new version of the same program, for a regeneration from the next unstarted week. */
export async function createProgramVersion(
  db: SqlExecutor,
  programId: string,
  weekLayout: Json,
  reason: string,
): Promise<ProgramVersion> {
  const id = newId('pver');
  const at = nowIso();
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<{ next: number | null }>(
      'SELECT MAX(version) + 1 AS next FROM program_version WHERE program_id = ?',
      [programId],
    );
    await db.runAsync(
      `INSERT INTO program_version (id, program_id, version, week_layout, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, programId, row?.next ?? 1, toJsonRequired(weekLayout), reason, at],
    );
    await db.runAsync('UPDATE program SET updated_at = ? WHERE id = ?', [at, programId]);
  });
  const version = await getProgramVersion(db, id);
  if (version === null) throw new Error('createProgramVersion: the version did not save.');
  return version;
}

export async function getProgram(db: SqlExecutor, programId: string): Promise<Program | null> {
  const row = await db.getFirstAsync<ProgramRow>('SELECT * FROM program WHERE id = ?', [programId]);
  return row === null ? null : mapProgram(row);
}

export async function getCurrentProgram(db: SqlExecutor): Promise<Program | null> {
  const row = await db.getFirstAsync<ProgramRow>(
    "SELECT * FROM program WHERE status = 'active' ORDER BY start_date DESC, created_at DESC LIMIT 1",
  );
  return row === null ? null : mapProgram(row);
}

export async function getProgramVersion(
  db: SqlExecutor,
  versionId: string,
): Promise<ProgramVersion | null> {
  const row = await db.getFirstAsync<VersionRow>('SELECT * FROM program_version WHERE id = ?', [
    versionId,
  ]);
  return row === null ? null : mapVersion(row);
}

export async function getLatestProgramVersion(
  db: SqlExecutor,
  programId: string,
): Promise<ProgramVersion | null> {
  const row = await db.getFirstAsync<VersionRow>(
    'SELECT * FROM program_version WHERE program_id = ? ORDER BY version DESC LIMIT 1',
    [programId],
  );
  return row === null ? null : mapVersion(row);
}

export async function listBlocks(db: SqlExecutor, programId: string): Promise<Block[]> {
  const rows = await db.getAllAsync<BlockRow>(
    'SELECT * FROM block WHERE program_id = ? ORDER BY order_index',
    [programId],
  );
  return rows.map(mapBlock);
}

export async function markProgramComplete(db: SqlExecutor, programId: string): Promise<void> {
  await db.runAsync("UPDATE program SET status = 'complete', updated_at = ? WHERE id = ?", [
    nowIso(),
    programId,
  ]);
}

/* ----------------------------------------------------------------- weeks */

export interface UpsertWeekInput {
  readonly programId: string;
  readonly w: number;
  readonly windowStart: LocalDate;
  readonly windowEnd: LocalDate;
  readonly kind: WeekKind;
  readonly k?: number | null;
  readonly blockId?: string | null;
  readonly programVersionId?: string | null;
  readonly prescribedCount?: number;
  readonly repeatOfWeek?: number | null;
  readonly jointHighStressCounts?: Json;
  readonly highContactAllowance?: number | null;
  readonly extensiveTarget?: number | null;
  readonly ladderRungs?: Json;
  /** The engine's WeekPlan, stored verbatim. */
  readonly snapshot?: Json;
  readonly generatedAt?: Timestamp | null;
  readonly generatedBy?: string | null;
}

export async function upsertWeek(db: SqlExecutor, input: UpsertWeekInput): Promise<Week> {
  const existing = await getWeek(db, input.programId, input.w);
  const id = existing?.id ?? newId('week');
  await db.runAsync(
    `INSERT INTO week
       (id, program_id, program_version_id, block_id, w, window_start, window_end, kind, k,
        prescribed_count, repeat_of_week, joint_high_stress_counts, high_contact_allowance,
        extensive_target, ladder_rungs, snapshot, generated_at, generated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(program_id, w) DO UPDATE SET
       program_version_id = excluded.program_version_id,
       block_id = excluded.block_id,
       window_start = excluded.window_start,
       window_end = excluded.window_end,
       kind = excluded.kind,
       k = excluded.k,
       prescribed_count = excluded.prescribed_count,
       repeat_of_week = excluded.repeat_of_week,
       joint_high_stress_counts = excluded.joint_high_stress_counts,
       high_contact_allowance = excluded.high_contact_allowance,
       extensive_target = excluded.extensive_target,
       ladder_rungs = excluded.ladder_rungs,
       snapshot = excluded.snapshot,
       generated_at = excluded.generated_at,
       generated_by = excluded.generated_by`,
    [
      id,
      input.programId,
      input.programVersionId ?? null,
      input.blockId ?? null,
      input.w,
      input.windowStart,
      input.windowEnd,
      input.kind,
      input.k ?? null,
      input.prescribedCount ?? 0,
      input.repeatOfWeek ?? null,
      toJson(input.jointHighStressCounts),
      input.highContactAllowance ?? null,
      input.extensiveTarget ?? null,
      toJson(input.ladderRungs),
      toJson(input.snapshot),
      input.generatedAt ?? null,
      input.generatedBy ?? null,
    ],
  );
  const saved = await getWeek(db, input.programId, input.w);
  if (saved === null) throw new Error('upsertWeek: the week did not save.');
  return saved;
}

export async function getWeek(db: SqlExecutor, programId: string, w: number): Promise<Week | null> {
  const row = await db.getFirstAsync<WeekRow>('SELECT * FROM week WHERE program_id = ? AND w = ?', [
    programId,
    w,
  ]);
  return row === null ? null : mapWeek(row);
}

export async function getWeekById(db: SqlExecutor, weekId: string): Promise<Week | null> {
  const row = await db.getFirstAsync<WeekRow>('SELECT * FROM week WHERE id = ?', [weekId]);
  return row === null ? null : mapWeek(row);
}

export async function listWeeks(db: SqlExecutor, programId: string): Promise<Week[]> {
  const rows = await db.getAllAsync<WeekRow>(
    'SELECT * FROM week WHERE program_id = ? ORDER BY w',
    [programId],
  );
  return rows.map(mapWeek);
}

/** The week whose window contains a date, which is how Today finds itself. */
export async function getWeekForDate(
  db: SqlExecutor,
  programId: string,
  date: LocalDate,
): Promise<Week | null> {
  const row = await db.getFirstAsync<WeekRow>(
    'SELECT * FROM week WHERE program_id = ? AND window_start <= ? AND window_end >= ? ORDER BY w LIMIT 1',
    [programId, date, date],
  );
  return row === null ? null : mapWeek(row);
}

export async function markWeekGenerated(
  db: SqlExecutor,
  weekId: string,
  generatedBy: string,
  snapshot?: Json,
): Promise<void> {
  const at = nowIso();
  if (snapshot === undefined) {
    await db.runAsync('UPDATE week SET generated_at = ?, generated_by = ? WHERE id = ?', [
      at,
      generatedBy,
      weekId,
    ]);
    return;
  }
  await db.runAsync(
    'UPDATE week SET generated_at = ?, generated_by = ?, snapshot = ? WHERE id = ?',
    [at, generatedBy, toJson(snapshot), weekId],
  );
}

export interface WeekOutcomePatch {
  readonly completedCount?: number;
  readonly adherencePct?: number | null;
  readonly allRepsCompleted?: boolean | null;
  readonly outcome?: WeekOutcome | null;
}

export async function setWeekOutcome(
  db: SqlExecutor,
  weekId: string,
  patch: WeekOutcomePatch,
): Promise<void> {
  await db.runAsync(
    `UPDATE week SET
       completed_count = COALESCE(?, completed_count),
       adherence_pct = COALESCE(?, adherence_pct),
       all_reps_completed = COALESCE(?, all_reps_completed),
       outcome = COALESCE(?, outcome)
     WHERE id = ?`,
    [
      patch.completedCount ?? null,
      patch.adherencePct ?? null,
      intBool(patch.allRepsCompleted),
      patch.outcome ?? null,
      weekId,
    ],
  );
}
