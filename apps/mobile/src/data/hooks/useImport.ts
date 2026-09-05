import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useDbOrNull } from '../db';
import type { SqlExecutor } from '../executor';
import type { ImportBatch, Instrument, Json, LocalDate } from '../types';
import { createJumpTest, type JumpAttemptInput } from '../store/jumpTests';
import {
  cancelImport,
  commitImport,
  getImportByHash,
  listImports,
  startImport,
  type StartImportInput,
} from '../store/imports';
import { newId, nowIso } from '../store/rows';
import { enqueue } from '../store/sync';
import { queryKeys } from './keys';

/**
 * The import's reads and its one write.
 *
 * The velocity tables have no repository yet, so the two `vbt_*` writes live
 * here beside the jump write rather than in a screen: features never touch
 * SQL. When `store/vbt.ts` lands they move there unchanged.
 */

/** One jump rep already in the database, flattened for dedupe. */
export interface ExistingJumpRep {
  readonly testId: string;
  readonly repId: string;
  readonly date: LocalDate;
  readonly heightMm: number;
  readonly entrySource: 'typed' | 'imported' | 'estimated';
}

/** One velocity set already in the database, flattened for dedupe. */
export interface ExistingVbtSet {
  readonly id: string;
  readonly date: LocalDate;
  readonly exercise: string;
  readonly set: number;
  readonly loadKg: number | null;
}

export interface ImportExistingData {
  readonly jumps: readonly ExistingJumpRep[];
  readonly velocitySets: readonly ExistingVbtSet[];
}

interface RepRow {
  readonly rep_id: string;
  readonly test_id: string;
  readonly local_date: string;
  readonly height_mm: number | null;
  readonly entry_source: string;
}

interface VbtRow {
  readonly id: string;
  readonly exercise_id: string;
  readonly load_kg: number | null;
  readonly recorded_at: string;
  readonly set_index: number | null;
}

function entrySourceOf(value: string): ExistingJumpRep['entrySource'] {
  return value === 'imported' || value === 'estimated' ? value : 'typed';
}

/** Everything an import has to compare itself against, in two queries. */
export async function readExistingForImport(db: SqlExecutor): Promise<ImportExistingData> {
  const reps = await db.getAllAsync<RepRow>(
    `SELECT r.id AS rep_id, r.jump_test_session_id AS test_id, t.local_date AS local_date,
            r.height_mm AS height_mm, r.entry_source AS entry_source
       FROM jump_rep r
       JOIN jump_test_session t ON t.id = r.jump_test_session_id
      WHERE r.height_mm IS NOT NULL`,
  );

  const sets = await db.getAllAsync<VbtRow>(
    `SELECT id, exercise_id, load_kg, recorded_at,
            CAST(COALESCE(reps_completed, 1) AS INTEGER) AS set_index
       FROM vbt_set`,
  );

  return {
    jumps: reps.map((row) => ({
      testId: row.test_id,
      repId: row.rep_id,
      date: row.local_date,
      heightMm: row.height_mm ?? 0,
      entrySource: entrySourceOf(row.entry_source),
    })),
    velocitySets: sets.map((row) => ({
      id: row.id,
      date: row.recorded_at.slice(0, 10),
      exercise: row.exercise_id,
      set: row.set_index ?? 1,
      loadKg: row.load_kg,
    })),
  };
}

export function useImportExistingData(enabled = true): UseQueryResult<ImportExistingData> {
  const db = useDbOrNull();
  return useQuery({
    queryKey: [...queryKeys.imports(), 'existing'],
    enabled: db !== null && enabled,
    queryFn: async () =>
      db === null ? { jumps: [], velocitySets: [] } : readExistingForImport(db),
  });
}

export function useImports(limit = 20): UseQueryResult<ImportBatch[]> {
  const db = useDbOrNull();
  return useQuery({
    queryKey: [...queryKeys.imports(), limit],
    enabled: db !== null,
    queryFn: async () => (db === null ? [] : listImports(db, limit)),
  });
}

/** One jump test to write: a date's attempts on one instrument and mode. */
export interface ImportJumpGroup {
  readonly localDate: LocalDate;
  readonly instrument: Instrument;
  readonly mode: string;
  readonly bodyweightKg: number | null;
  readonly attempts: readonly JumpAttemptInput[];
}

/** One velocity set to write, with its per-rep values. */
export interface ImportVbtSet {
  readonly localDate: LocalDate;
  readonly exerciseId: string;
  readonly setNumber: number;
  readonly loadKg: number | null;
  readonly repsCompleted: number;
  readonly meanVelocityBest: number | null;
  readonly meanVelocityLast: number | null;
  readonly velocityLossPct: number | null;
  readonly reps: readonly {
    readonly repIndex: number;
    readonly meanVelocity: number | null;
    readonly peakVelocity: number | null;
    readonly romMm: number | null;
    readonly powerW: number | null;
  }[];
}

export interface CommitImportInput {
  readonly batch: StartImportInput;
  readonly jumps: readonly ImportJumpGroup[];
  readonly sets: readonly ImportVbtSet[];
}

export interface CommitImportResult {
  readonly batchId: string;
  /** False when this file had already been committed. Nothing was written. */
  readonly wrote: boolean;
  readonly testsWritten: number;
  readonly setsWritten: number;
}

async function writeVbtSet(
  db: SqlExecutor,
  batchId: string,
  set: ImportVbtSet,
): Promise<void> {
  const id = newId('vbt');
  await db.runAsync(
    `INSERT INTO vbt_set
       (id, set_log_id, session_id, exercise_id, load_kg, reps_completed,
        mean_velocity_best, mean_velocity_last, velocity_loss_pct,
        entry_source, import_batch_id, recorded_at)
     VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, 'imported', ?, ?)`,
    [
      id,
      set.exerciseId,
      set.loadKg,
      set.repsCompleted,
      set.meanVelocityBest,
      set.meanVelocityLast,
      set.velocityLossPct,
      batchId,
      `${set.localDate}T00:00:00.000Z`,
    ],
  );
  for (const rep of set.reps) {
    await db.runAsync(
      `INSERT INTO vbt_rep
         (id, vbt_set_id, rep_index, mean_velocity, peak_velocity, rom_mm, power_w, tpv_ms, eai, import_batch_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
       ON CONFLICT DO NOTHING`,
      [
        newId('vrep'),
        id,
        rep.repIndex,
        rep.meanVelocity,
        rep.peakVelocity,
        rep.romMm === null ? null : Math.round(rep.romMm),
        rep.powerW,
        batchId,
      ],
    );
  }
}

/**
 * True when this batch already carries a test for that day and instrument.
 *
 * A commit is many transactions, not one: each jump group writes its own, so a
 * crash or a process kill part way through leaves the batch at 'preview' with
 * some of its tests already on disk. The file hash then protects nothing, and
 * re-picking the same export used to replay the loop from the first group and
 * double every dot on the trend line. A resumed batch skips what it already
 * wrote, so a re-import of the same file stays a no-op.
 */
async function jumpAlreadyWritten(
  db: SqlExecutor,
  batchId: string,
  group: ImportJumpGroup,
): Promise<boolean> {
  const row = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM jump_test_session
      WHERE import_batch_id = ? AND local_date = ? AND instrument = ? AND mode = ?
      LIMIT 1`,
    [batchId, group.localDate, group.instrument, group.mode],
  );
  return row !== null;
}

/**
 * Commit a previewed import. The file hash is the idempotency key: a file that
 * has already been committed writes nothing and reports so, and a file whose
 * commit was interrupted resumes rather than starting over.
 */
export async function commitImportBatch(
  db: SqlExecutor,
  input: CommitImportInput,
): Promise<CommitImportResult> {
  const existing = await getImportByHash(db, input.batch.fileHash);
  if (existing !== null && existing.status === 'committed') {
    return { batchId: existing.id, wrote: false, testsWritten: 0, setsWritten: 0 };
  }

  const { batch } = await startImport(db, input.batch);
  const resuming = existing !== null;

  let testsWritten = 0;
  for (const group of input.jumps) {
    if (resuming && (await jumpAlreadyWritten(db, batch.id, group))) continue;
    await createJumpTest(db, {
      localDate: group.localDate,
      performedAt: `${group.localDate}T12:00:00.000Z`,
      instrument: group.instrument,
      mode: group.mode,
      canonical: false,
      scheduled: false,
      bodyweightKg: group.bodyweightKg,
      importBatchId: batch.id,
      attempts: group.attempts,
    });
    testsWritten += 1;
  }

  // The velocity sets are one transaction, so they are all there or none are.
  // A resumed batch rewrites them wholesale rather than counting rows.
  await db.withTransactionAsync(async () => {
    if (resuming) {
      await db.runAsync(
        `DELETE FROM vbt_rep
          WHERE vbt_set_id IN (SELECT id FROM vbt_set WHERE import_batch_id = ?)`,
        [batch.id],
      );
      await db.runAsync('DELETE FROM vbt_set WHERE import_batch_id = ?', [batch.id]);
    }
    for (const set of input.sets) await writeVbtSet(db, batch.id, set);
  });

  const counts: Json = {
    jumpTests: input.jumps.length,
    jumpReps: input.jumps.reduce((total, group) => total + group.attempts.length, 0),
    velocitySets: input.sets.length,
    committedAt: nowIso(),
  };
  await commitImport(db, batch.id, counts);
  await enqueue(db, { kind: 'import.commit', entityId: batch.id, payload: counts });

  return {
    batchId: batch.id,
    wrote: true,
    testsWritten,
    setsWritten: input.sets.length,
  };
}

export function useCommitImport(): ReturnType<
  typeof useMutation<CommitImportResult, Error, CommitImportInput>
> {
  const db = useDbOrNull();
  const client = useQueryClient();
  return useMutation<CommitImportResult, Error, CommitImportInput>({
    mutationFn: async (input) => {
      if (db === null) throw new Error('The database is not open yet.');
      return commitImportBatch(db, input);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.imports() });
      void client.invalidateQueries({ queryKey: queryKeys.testsAll() });
      void client.invalidateQueries({ queryKey: queryKeys.sync() });
    },
  });
}

export function useCancelImport(): ReturnType<typeof useMutation<void, Error, string>> {
  const db = useDbOrNull();
  const client = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (batchId) => {
      if (db === null) throw new Error('The database is not open yet.');
      await cancelImport(db, batchId);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.imports() });
    },
  });
}
