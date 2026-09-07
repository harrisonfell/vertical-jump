import { beforeAll, describe, expect, it } from 'vitest';
import { loadRuleset, planSkeleton } from '@vert/engine';
import type { Athlete as EngineAthlete } from '@vert/engine';
import type { Json, Program, SqlExecutor, SqlParams } from '@/data';
import { openMigratedTestDb } from '@/data/testing/testDb';
import { upsertAthlete } from '@/data/store/athlete';
import {
  createProgramVersion,
  getProgram,
  listBlocks,
  listWeeks,
} from '@/data/store/program';
import { listSessionsByWeek } from '@/data/store/sessions';
import { listWeekEngineLogs } from '@/data/store/revision';
import { toEngineAthlete } from '@/lib/engineAthlete';
import { readSkeleton, readWeekPlan } from './engine';
import { revisionTarget } from './revise';
import { BASELINE, buildTestProgram, logOneSet, trainWeek } from './testProgram';
import { reviseProgram } from './useRevise';

/**
 * The whole revision path, against the same sql.js engine the web build runs
 * on: build a program, train week 1 for real, revise, and check that the week
 * the athlete trained is untouched to the byte while every unstarted week
 * behind it is written again.
 *
 * The three things that would go wrong silently are exactly what this asserts.
 * A revision that rewrote a logged week would destroy evidence. A fold that
 * failed to rename the store's session ids to the engine's would read every
 * real week as "nothing logged" and quietly drop working maxes. And a revision
 * that recorded itself before it finished would leave a half-rebuilt plan with
 * nothing left to trigger a retry.
 */

/** Inside week 1's window: week 1 has opened, week 2 has not. */
const TODAY = '2026-09-09';

interface WeekOneRows {
  readonly sessions: unknown[];
  readonly exercises: unknown[];
  readonly logs: unknown[];
}

/** Every row week 1 owns, in a stable order, for a before-and-after compare. */
async function weekRows(db: SqlExecutor, weekId: string): Promise<WeekOneRows> {
  return {
    sessions: await db.getAllAsync(
      'SELECT * FROM session WHERE week_id = ? ORDER BY order_index',
      [weekId],
    ),
    exercises: await db.getAllAsync(
      `SELECT x.* FROM session_exercise x JOIN session s ON s.id = x.session_id
        WHERE s.week_id = ? ORDER BY s.order_index, x.order_index`,
      [weekId],
    ),
    logs: await db.getAllAsync(
      `SELECT l.* FROM set_log l JOIN session s ON s.id = l.session_id
        WHERE s.week_id = ? ORDER BY l.idempotency_key`,
      [weekId],
    ),
  };
}

let db: SqlExecutor;
let engineAthlete: EngineAthlete;
let program: Program;
let weekOneId: string;
let before: WeekOneRows;
let sessionIdsBefore: Set<string>;

beforeAll(async () => {
  db = await openMigratedTestDb();
  const built = await buildTestProgram(db);
  engineAthlete = built.engineAthlete;
  program = built.program;

  const weeks = await listWeeks(db, program.id);
  weekOneId = weeks[0]?.id ?? '';
  const all = await db.getAllAsync<{ id: string }>('SELECT id FROM session');
  sessionIdsBefore = new Set(all.map((row) => row.id));

  await trainWeek(db, weekOneId, TODAY);
  before = await weekRows(db, weekOneId);
});

describe('reviseProgram', () => {
  it('reads week 1s real logs back in the engines own names', async () => {
    const logs = await listWeekEngineLogs(db, weekOneId);
    expect(logs.length).toBeGreaterThan(0);
    // Not one store id survives the seam: judgeReps only matches w1-dN.
    expect(logs.every((log) => log.sessionId.startsWith('w1-'))).toBe(true);
    expect(logs.every((log) => !log.sessionId.startsWith('sess_'))).toBe(true);
    expect(logs.every((log) => log.exerciseId !== '')).toBe(true);
    expect(logs.every((log) => log.plannedDate.startsWith('2026-09'))).toBe(true);
  });

  it('rebuilds every week after the one that was trained', async () => {
    const result = await reviseProgram(db, { athlete: engineAthlete, program, today: TODAY });
    expect(result.fromWeek).toBe(2);
    expect(result.observedThrough).toBe(1);
    expect(result.revisedWeeks).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(result.versionNumber).toBe(2);
  });

  it('leaves week 1 exactly as it was, row for row', async () => {
    expect(await weekRows(db, weekOneId)).toEqual(before);
  });

  it('leaves week 1s own row saying it came from setup', async () => {
    const weeks = await listWeeks(db, program.id);
    expect(weeks[0]?.generatedBy).toBe('setup');
    expect(weeks[0]?.w).toBe(1);
  });

  it('writes new sessions for every revised week, under new ids', async () => {
    const weeks = await listWeeks(db, program.id);
    for (const week of weeks.slice(1)) {
      const sessions = await listSessionsByWeek(db, week.id, TODAY);
      expect(sessions.length).toBeGreaterThan(0);
      for (const session of sessions) {
        expect(sessionIdsBefore.has(session.id)).toBe(false);
        expect(session.loggedSetCount).toBe(0);
        expect(session.prescribedSetCount).toBeGreaterThan(0);
      }
      expect(week.generatedBy).toBe('revision');
      expect(readWeekPlan(week.snapshot)?.w).toBe(week.w);
      expect(week.prescribedCount).toBe(sessions.length);
    }
  });

  it('points every revised week at the version row it wrote last', async () => {
    const versions = await db.getAllAsync<{ id: string; version: number }>(
      'SELECT id, version FROM program_version WHERE program_id = ? ORDER BY version',
      [program.id],
    );
    const second = versions[1]?.id;
    expect(second).toBeDefined();
    const weeks = await listWeeks(db, program.id);
    for (const week of weeks.slice(1)) expect(week.programVersionId).toBe(second);
  });

  it('writes one version row, with the week it revised from and a readable span', async () => {
    const versions = await db.getAllAsync<{ version: number; reason: string; week_layout: string }>(
      'SELECT version, reason, week_layout FROM program_version WHERE program_id = ? ORDER BY version',
      [program.id],
    );
    expect(versions.map((row) => row.reason)).toEqual(['first build', 'revised from week 1']);
    // versionSpan returns null for anything that is not an array, and the
    // Plan's version history would silently lose its date range.
    const layout = JSON.parse(versions[1]?.week_layout ?? 'null') as { w: number }[];
    expect(Array.isArray(layout)).toBe(true);
    expect(layout.map((entry) => entry.w)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('enqueues one week.generated op per revised week and none for sessions', async () => {
    const ops = await db.getAllAsync<{ op: string }>(
      "SELECT op FROM sync_queue WHERE op = 'week.generated'",
    );
    expect(ops).toHaveLength(11);
    const sessionOps = await db.getAllAsync<{ op: string }>(
      "SELECT op FROM sync_queue WHERE op LIKE 'session.%'",
    );
    expect(sessionOps).toHaveLength(0);
  });

  it('does nothing the second time, because no newer week has been logged', async () => {
    const weeksBefore = await listWeeks(db, program.id);
    const again = await reviseProgram(db, { athlete: engineAthlete, program, today: TODAY });
    expect(again.revisedWeeks).toEqual([]);
    expect(again.versionNumber).toBeNull();
    expect(await listWeeks(db, program.id)).toEqual(weeksBefore);
  });
});

/* --------------------------------------------------- a revision that fails */

/**
 * An executor that lets one week's write fail, and nothing else.
 *
 * The write is the only place a real revision can die halfway: a full disk, a
 * killed process, a constraint nobody predicted. What must not happen is that
 * the attempt still counts as a revision, because the version row's reason is
 * what tells the trigger whether there is anything left to do.
 */
function failingOnWeek(real: SqlExecutor, w: number): SqlExecutor {
  return {
    ...real,
    runAsync: (sql: string, params?: SqlParams) => {
      if (sql.includes('INSERT INTO week') && params?.[4] === w) {
        return Promise.reject(new Error('disk full'));
      }
      return real.runAsync(sql, params);
    },
    withTransactionAsync: (fn: () => Promise<void>) => real.withTransactionAsync(fn),
  };
}

describe('reviseProgram when a week write fails', () => {
  let failDb: SqlExecutor;
  let failProgram: Program;
  let failAthlete: EngineAthlete;

  beforeAll(async () => {
    failDb = await openMigratedTestDb();
    const built = await buildTestProgram(failDb);
    failProgram = built.program;
    failAthlete = built.engineAthlete;
    const weeks = await listWeeks(failDb, failProgram.id);
    await trainWeek(failDb, weeks[0]?.id ?? '', TODAY);
  });

  it('writes no version row, so the trigger still fires afterwards', async () => {
    const input = { athlete: failAthlete, program: failProgram, today: TODAY };
    await expect(reviseProgram(failingOnWeek(failDb, 3), input)).rejects.toThrow('disk full');

    const versions = await failDb.getAllAsync<{ reason: string }>(
      'SELECT reason FROM program_version WHERE program_id = ? ORDER BY version',
      [failProgram.id],
    );
    // The version row is the record that the revision finished. Written first,
    // it survives the failure, `projectedFromReason` reads week 1 back out of
    // it, and the plan sits half rebuilt with the trigger disabled for good.
    expect(versions.map((row) => row.reason)).toEqual(['first build']);

    const weeks = await listWeeks(failDb, failProgram.id);
    const target = revisionTarget({
      weeks: weeks.map((week) => ({
        w: week.w,
        windowStart: week.windowStart,
        loggedSets: week.w === 1 ? 1 : 0,
      })),
      today: TODAY,
      latestReason: versions[versions.length - 1]?.reason,
    });
    expect(target.shouldRevise).toBe(true);
    expect(target.fromWeek).toBe(2);
  });

  it('rebuilds the whole range once the write works again', async () => {
    const result = await reviseProgram(failDb, {
      athlete: failAthlete,
      program: failProgram,
      today: TODAY,
    });
    expect(result.revisedWeeks).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(result.versionNumber).toBe(2);
    for (const week of (await listWeeks(failDb, failProgram.id)).slice(1)) {
      expect(readWeekPlan(week.snapshot)?.w).toBe(week.w);
    }
  });
});

/* --------------------------------------- a revision after a regeneration */

describe('reviseProgram after a settings regeneration', () => {
  let regenDb: SqlExecutor;
  let regenProgram: Program;
  let threeDayAthlete: EngineAthlete;

  beforeAll(async () => {
    regenDb = await openMigratedTestDb();
    const built = await buildTestProgram(regenDb);
    regenProgram = built.program;
    const weeks = await listWeeks(regenDb, regenProgram.id);
    await trainWeek(regenDb, weeks[0]?.id ?? '', TODAY);

    // Exactly what Settings does when the athlete drops to three days: a new
    // skeleton, stored on a new version row, with `program.snapshot` untouched.
    const patched = await upsertAthlete(regenDb, { daysPerWeek: 3, weekdays: [1, 3, 5] });
    threeDayAthlete = toEngineAthlete({ athlete: patched, pains: [], baseline: BASELINE });
    const skeleton = planSkeleton(threeDayAthlete, TODAY, loadRuleset());
    await createProgramVersion(
      regenDb,
      regenProgram.id,
      { fromWeek: 2, skeleton, changedFields: ['daysPerWeek'] } as unknown as Json,
      'days a week changed',
    );
  });

  it('rebuilds from the new answers, not the skeleton the build stored', async () => {
    const result = await reviseProgram(regenDb, {
      athlete: threeDayAthlete,
      program: regenProgram,
      today: TODAY,
    });
    expect(result.revisedWeeks[0]).toBe(2);

    const weeks = await listWeeks(regenDb, regenProgram.id);
    // Four days as built, three days after the regeneration. Reading
    // `program.snapshot` here would have written four again.
    expect(await listSessionsByWeek(regenDb, weeks[0]?.id ?? '', TODAY)).toHaveLength(4);
    for (const week of weeks.slice(1)) {
      expect(await listSessionsByWeek(regenDb, week.id, TODAY)).toHaveLength(3);
    }
  });

  it('stores the new skeleton, so the next revision does not undo it', async () => {
    const saved = await getProgram(regenDb, regenProgram.id);
    expect(readSkeleton(saved?.snapshot ?? null)?.daysPerWeek).toBe(3);

    // The newest version row is now the revision's own array layout, so the
    // regeneration's skeleton is no longer consulted and the snapshot is what
    // the next revision reads.
    const weeks = await listWeeks(regenDb, regenProgram.id);
    await trainWeek(regenDb, weeks[1]?.id ?? '', weeks[1]?.windowEnd ?? TODAY);
    const again = await reviseProgram(regenDb, {
      athlete: threeDayAthlete,
      program: saved ?? regenProgram,
      today: weeks[1]?.windowEnd ?? TODAY,
    });
    expect(again.revisedWeeks[0]).toBe(3);
    for (const week of (await listWeeks(regenDb, regenProgram.id)).slice(2)) {
      expect(await listSessionsByWeek(regenDb, week.id, TODAY)).toHaveLength(3);
    }
  });
});

/* ----------------------------------- a revision that absorbs a skipped week */

describe('reviseProgram when a folded week was skipped entirely', () => {
  let skipDb: SqlExecutor;
  let skipProgram: Program;
  let skipAthlete: EngineAthlete;
  /** The last day of week 2, so week 3 is the first week not yet begun. */
  let day: string;
  let blocksBefore: unknown[];

  beforeAll(async () => {
    skipDb = await openMigratedTestDb();
    const built = await buildTestProgram(skipDb);
    skipProgram = built.program;
    skipAthlete = built.engineAthlete;
    const weeks = await listWeeks(skipDb, skipProgram.id);
    day = weeks[1]?.windowEnd ?? TODAY;
    await trainWeek(skipDb, weeks[0]?.id ?? '', day);
    // Week 2 is left alone: its window passes with nothing logged in it, which
    // is what R94 calls a repeat.
    blocksBefore = await listBlocks(skipDb, skipProgram.id);
  });

  it('absorbs the repeat into the stored skeleton', async () => {
    const result = await reviseProgram(skipDb, {
      athlete: skipAthlete,
      program: skipProgram,
      today: day,
    });
    expect(result.fromWeek).toBe(3);
    expect(result.revisedWeeks[0]).toBe(3);

    const saved = await getProgram(skipDb, skipProgram.id);
    const skeleton = readSkeleton(saved?.snapshot ?? null);
    expect(skeleton).not.toBeNull();
    expect(skeleton?.weeks.some((week) => week.repeatOfWeek !== undefined)).toBe(true);
  });

  it('rewrites the block rows to match the skeleton it ended on', async () => {
    const saved = await getProgram(skipDb, skipProgram.id);
    const skeleton = readSkeleton(saved?.snapshot ?? null);
    const rows = await listBlocks(skipDb, skipProgram.id);

    // The bands the Plan draws come from these rows. Left as the build wrote
    // them, they would sit a week out over every week the absorption moved.
    expect(rows.map((row) => [row.type, row.orderIndex, row.weekStart, row.weekEnd])).toEqual(
      (skeleton?.blocks ?? []).map((block, index) => [
        block.type,
        index,
        block.weekFrom,
        block.weekTo,
      ]),
    );
    expect(rows).not.toEqual(blocksBefore);
  });

  it('gives the week rows the kinds the absorbed skeleton says', async () => {
    const saved = await getProgram(skipDb, skipProgram.id);
    const skeleton = readSkeleton(saved?.snapshot ?? null);
    const rows = await listWeeks(skipDb, skipProgram.id);
    for (const week of rows.slice(2)) {
      const planned = skeleton?.weeks.find((entry) => entry.w === week.w);
      expect(week.kind).toBe(planned?.kind);
    }
  });
});

/* -------------------------------------- a set logged against a later week */

describe('reviseProgram when a set is logged out of order', () => {
  let outDb: SqlExecutor;
  let outProgram: Program;
  let outAthlete: EngineAthlete;
  let endOfWeekTwo: string;
  let endOfWeekThree: string;

  beforeAll(async () => {
    outDb = await openMigratedTestDb();
    const built = await buildTestProgram(outDb);
    outProgram = built.program;
    outAthlete = built.engineAthlete;
    const weeks = await listWeeks(outDb, outProgram.id);
    endOfWeekTwo = weeks[1]?.windowEnd ?? TODAY;
    endOfWeekThree = weeks[2]?.windowEnd ?? TODAY;
    await trainWeek(outDb, weeks[0]?.id ?? '', endOfWeekTwo);
    // One set entered late against week 4, which the fold will not reach.
    await logOneSet(outDb, weeks[3]?.id ?? '', endOfWeekTwo);
  });

  it('records the week the fold reached, not the week the stray set is in', async () => {
    const result = await reviseProgram(outDb, {
      athlete: outAthlete,
      program: outProgram,
      today: endOfWeekTwo,
    });
    expect(result.fromWeek).toBe(3);
    expect(result.observedThrough).toBe(4);
    // Week 4 carries work, so the rebuild stops before it and the fold only
    // ever saw weeks 1 and 2.
    expect(result.revisedWeeks).toEqual([3]);

    const versions = await outDb.getAllAsync<{ reason: string }>(
      'SELECT reason FROM program_version WHERE program_id = ? ORDER BY version',
      [outProgram.id],
    );
    expect(versions.map((row) => row.reason)).toEqual(['first build', 'revised from week 2']);
  });

  it('still fires once the week in between is trained', async () => {
    const weeks = await listWeeks(outDb, outProgram.id);
    await trainWeek(outDb, weeks[2]?.id ?? '', endOfWeekThree);

    // Recording week 4 instead would have left nothing able to beat it until
    // week 5 was logged, and week 5 is the week this revision is meant to write.
    const again = await reviseProgram(outDb, {
      athlete: outAthlete,
      program: outProgram,
      today: endOfWeekThree,
    });
    expect(again.fromWeek).toBe(5);
    expect(again.revisedWeeks[0]).toBe(5);
  });
});
