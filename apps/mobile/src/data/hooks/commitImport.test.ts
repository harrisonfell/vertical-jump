import { beforeEach, describe, expect, it } from 'vitest';
import type { SqlExecutor } from '../executor';
import { openMigratedTestDb } from '../testing/testDb';
import { upsertAthlete } from '../store/athlete';
import { getImportByHash } from '../store/imports';
import { listJumpTests } from '../store/jumpTests';
import { commitImportBatch, type CommitImportInput, type ImportJumpGroup } from './useImport';

/**
 * The import's idempotency promise, which the brief states plainly: a
 * re-import of the same file is a no-op.
 *
 * A commit is many transactions, not one. Each jump group writes its own, so a
 * crash or a process kill part way through leaves the batch at 'preview' with
 * some of its tests already on disk, and the file hash then protects nothing:
 * re-picking the same export used to replay the loop from the first group and
 * double every dot on the trend line.
 */

let db: SqlExecutor;

beforeEach(async () => {
  db = await openMigratedTestDb();
  await upsertAthlete(db, { timezone: 'America/New_York', rolloverHour: 4 });
});

function group(localDate: string, heightMm: number): ImportJumpGroup {
  return {
    localDate,
    instrument: 'ovr_jump_regular',
    mode: 'Regular',
    bodyweightKg: 82,
    attempts: [{ attemptIndex: 1, heightMm, flagged: false }],
  };
}

const FOUR: readonly ImportJumpGroup[] = [
  group('2026-08-03', 780),
  group('2026-08-10', 790),
  group('2026-08-17', 800),
  group('2026-08-24', 810),
];

function input(jumps: readonly ImportJumpGroup[]): CommitImportInput {
  return {
    batch: {
      fileHash: 'sha256:the-same-export',
      fileName: 'ovr-export.csv',
      type: 'ovr_jump',
      rowCount: jumps.length,
    },
    jumps,
    sets: [],
  };
}

describe('commitImportBatch', () => {
  it('writes every group once', async () => {
    const result = await commitImportBatch(db, input(FOUR));
    expect(result.wrote).toBe(true);
    expect(result.testsWritten).toBe(4);
    expect(await listJumpTests(db, { instrument: 'ovr_jump_regular' })).toHaveLength(4);
  });

  it('does nothing when the same file is picked again', async () => {
    await commitImportBatch(db, input(FOUR));
    const again = await commitImportBatch(db, input(FOUR));
    expect(again.wrote).toBe(false);
    expect(await listJumpTests(db, { instrument: 'ovr_jump_regular' })).toHaveLength(4);
  });

  it('resumes an interrupted commit instead of duplicating what landed', async () => {
    // Two of four groups written, then the process dies: the batch is still
    // 'preview', so the hash short circuit does not fire on the retry.
    await commitImportBatch(db, input(FOUR.slice(0, 2)));
    const batch = await getImportByHash(db, 'sha256:the-same-export');
    await db.runAsync("UPDATE import_batch SET status = 'preview' WHERE id = ?", [batch?.id ?? '']);

    const retry = await commitImportBatch(db, input(FOUR));
    expect(retry.testsWritten).toBe(2);

    const tests = await listJumpTests(db, { instrument: 'ovr_jump_regular' });
    expect(tests).toHaveLength(4);
    expect(new Set(tests.map((test) => test.localDate)).size).toBe(4);
  });
});
