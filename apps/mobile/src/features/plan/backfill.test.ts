import { beforeAll, describe, expect, it } from 'vitest';
import type { Athlete as EngineAthlete } from '@vert/engine';
import type { Program, SqlExecutor } from '@/data';
import { openMigratedTestDb } from '@/data/testing/testDb';
import { listWeeks } from '@/data/store/program';
import { listSessionsByWeek } from '@/data/store/sessions';
import { backfillProgram, backfillRange } from './backfill';
import { readWeekPlan } from './engine';
import { revisionTarget } from './revise';
import { buildTestProgram, trainWeek } from './testProgram';
import { reviseProgram } from './useRevise';

/**
 * The rescue path for a program built before the app projected past week 1.
 *
 * Such a program is written here by building a current one and then taking it
 * apart the way the old build left it: weeks 2..12 as bare rows with no stored
 * plan and no sessions. Those weeks cannot be opened, and the revision path
 * cannot repair them either, because its fold refuses a week with no readable
 * saved plan. Without the backfill an athlete's existing program would stay a
 * one-week program for the rest of the block.
 */

/** Inside week 1's window: week 1 has opened, week 2 has not. */
const TODAY = '2026-09-09';

/** Everything the old build never wrote, taken back out again. */
async function makeOldStyle(db: SqlExecutor, programId: string): Promise<void> {
  await db.runAsync(
    'DELETE FROM session WHERE week_id IN (SELECT id FROM week WHERE program_id = ? AND w > 1)',
    [programId],
  );
  await db.runAsync(
    `UPDATE week SET snapshot = NULL, generated_at = NULL, generated_by = NULL
      WHERE program_id = ? AND w > 1`,
    [programId],
  );
}

describe('backfillRange', () => {
  const week = (w: number, over: Partial<{ hasPlan: boolean; sessionCount: number; loggedSets: number }> = {}) => ({
    w,
    hasPlan: over.hasPlan ?? true,
    sessionCount: over.sessionCount ?? 4,
    loggedSets: over.loggedSets ?? 0,
  });

  it('finds nothing when every week holds a plan', () => {
    expect(backfillRange([week(1), week(2), week(3)])).toBeNull();
  });

  it('takes the run of empty weeks after the ones that were written', () => {
    const bare = { hasPlan: false, sessionCount: 0 };
    expect(backfillRange([week(1), week(2, bare), week(3, bare), week(4, bare)])).toEqual({
      fromWeek: 2,
      toWeek: 4,
    });
  });

  it('stops before a week that has sessions of its own', () => {
    const bare = { hasPlan: false, sessionCount: 0 };
    expect(backfillRange([week(1), week(2, bare), week(3, bare), week(4), week(5, bare)])).toEqual({
      fromWeek: 2,
      toWeek: 3,
    });
  });

  it('never takes a week with anything logged in it', () => {
    const logged = { hasPlan: false, sessionCount: 0, loggedSets: 3 };
    expect(backfillRange([week(1, logged)])).toBeNull();
  });
});

describe('backfillProgram', () => {
  let db: SqlExecutor;
  let program: Program;
  let engineAthlete: EngineAthlete;
  let weekOneId: string;
  let weekOneSessions: number;

  beforeAll(async () => {
    db = await openMigratedTestDb();
    const built = await buildTestProgram(db);
    program = built.program;
    engineAthlete = built.engineAthlete;

    const weeks = await listWeeks(db, program.id);
    weekOneId = weeks[0]?.id ?? '';
    weekOneSessions = (await listSessionsByWeek(db, weekOneId, TODAY)).length;
    await makeOldStyle(db, program.id);
  });

  it('has nothing to open before it runs', async () => {
    const weeks = await listWeeks(db, program.id);
    for (const entry of weeks.slice(1)) {
      expect(readWeekPlan(entry.snapshot)).toBeNull();
      expect(await listSessionsByWeek(db, entry.id, TODAY)).toHaveLength(0);
    }
  });

  it('projects every empty week and writes its sessions', async () => {
    const filled = await backfillProgram(db, { athlete: engineAthlete, program, today: TODAY });
    expect(filled).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

    const weeks = await listWeeks(db, program.id);
    for (const entry of weeks.slice(1)) {
      const sessions = await listSessionsByWeek(db, entry.id, TODAY);
      expect(sessions.length).toBeGreaterThan(0);
      expect(entry.prescribedCount).toBe(sessions.length);
      expect(readWeekPlan(entry.snapshot)?.w).toBe(entry.w);
      // The honest word: these weeks came from the plan as written, not from
      // anything the athlete has logged.
      expect(entry.generatedBy).toBe('projection');
    }
  });

  it('leaves the week that was already written alone', async () => {
    const weeks = await listWeeks(db, program.id);
    expect(weeks[0]?.generatedBy).toBe('setup');
    expect(await listSessionsByWeek(db, weekOneId, TODAY)).toHaveLength(weekOneSessions);
  });

  it('does nothing the second time', async () => {
    const before = await listWeeks(db, program.id);
    const filled = await backfillProgram(db, { athlete: engineAthlete, program, today: TODAY });
    expect(filled).toEqual([]);
    expect(await listWeeks(db, program.id)).toEqual(before);
  });

  it('writes no version row, so the revision trigger still fires', async () => {
    const versions = await db.getAllAsync<{ reason: string }>(
      'SELECT reason FROM program_version WHERE program_id = ? ORDER BY version',
      [program.id],
    );
    expect(versions.map((row) => row.reason)).toEqual(['first build']);

    await trainWeek(db, weekOneId, TODAY);
    const weeks = await listWeeks(db, program.id);
    const sessions = await listSessionsByWeek(db, weekOneId, TODAY);
    const logged = sessions.reduce((total, session) => total + session.loggedSetCount, 0);
    const target = revisionTarget({
      weeks: weeks.map((week) => ({
        w: week.w,
        windowStart: week.windowStart,
        loggedSets: week.w === 1 ? logged : 0,
      })),
      today: TODAY,
      latestReason: versions[versions.length - 1]?.reason,
    });
    expect(target.shouldRevise).toBe(true);
  });

  it('can be revised from real outcomes once a week is trained', async () => {
    const result = await reviseProgram(db, { athlete: engineAthlete, program, today: TODAY });
    expect(result.revisedWeeks).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const week of (await listWeeks(db, program.id)).slice(1)) {
      expect(week.generatedBy).toBe('revision');
      expect(readWeekPlan(week.snapshot)?.w).toBe(week.w);
    }
  });
});
