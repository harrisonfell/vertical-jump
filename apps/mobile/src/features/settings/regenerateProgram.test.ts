import { beforeAll, describe, expect, it } from 'vitest';
import type { Athlete, Program, SqlExecutor, SqlParams } from '@/data';
import { openMigratedTestDb } from '@/data/testing/testDb';
import { upsertAthlete } from '@/data/store/athlete';
import { getProgram, listWeeks } from '@/data/store/program';
import { listSessionExercises, listSessionsByWeek } from '@/data/store/sessions';
import { toEngineAthlete } from '@/lib/engineAthlete';
import { readPrescriptions, readSkeleton } from '../plan/engine';
import { revisionTarget } from '../plan/revise';
import { BASELINE, buildTestProgram, trainWeek } from '../plan/testProgram';
import { reviseProgram } from '../plan/useRevise';
import { readWeekFacts } from '../plan/rebuild';
import { nextUnstartedWeek, type ParamChange } from './regenerate';
import { RegenerationFailedError, regenerateProgram } from './useRegenerate';

/**
 * A Settings edit, all the way to the rows.
 *
 * The whole point of the change under test is that the athlete sees the new
 * plan the moment they confirm. So these run the real path against the same
 * sql.js engine the web build uses: build twelve weeks, train week 1 for real,
 * change an answer, and check that every unstarted week is written again from
 * the new answer while the trained week is untouched to the byte.
 *
 * The two things that would go wrong silently are what this asserts hardest. A
 * regeneration that wrote no sessions would leave the Plan showing the answers
 * the athlete has just replaced. And one that finished without saying so would
 * be revised over again on the next Today mount, churning identical weeks under
 * new ids and adding a version row every time the app is opened.
 */

/** Inside week 1's window: week 1 has opened, week 2 has not. */
const TODAY = '2026-09-09';

const DAYS_CHANGE: ParamChange[] = [
  { field: 'daysPerWeek', label: 'Days a week', from: '4', to: '3' },
];

const AGE_CHANGE: ParamChange[] = [
  { field: 'trainingAge', label: 'Training age', from: '4+ yrs', to: '1-3 yrs' },
];

interface WeekRows {
  readonly sessions: unknown[];
  readonly exercises: unknown[];
  readonly logs: unknown[];
}

/** Every row a week owns, in a stable order, for a before-and-after compare. */
async function weekRows(db: SqlExecutor, weekId: string): Promise<WeekRows> {
  return {
    sessions: await db.getAllAsync('SELECT * FROM session WHERE week_id = ? ORDER BY order_index', [
      weekId,
    ]),
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

/** The highest percent of a working max prescribed anywhere in a week. */
async function topPercent(db: SqlExecutor, weekId: string): Promise<number> {
  let highest = 0;
  for (const session of await listSessionsByWeek(db, weekId, TODAY)) {
    for (const row of await listSessionExercises(db, session.id)) {
      for (const set of readPrescriptions(row.perSet)) {
        if (set.loadPercent !== undefined && set.loadPercent > highest) highest = set.loadPercent;
      }
    }
  }
  return highest;
}

async function versionRows(
  db: SqlExecutor,
  programId: string,
): Promise<{ version: number; reason: string; week_layout: string }[]> {
  return db.getAllAsync(
    'SELECT version, reason, week_layout FROM program_version WHERE program_id = ? ORDER BY version',
    [programId],
  );
}

/* ------------------------------------------------ dropping to three days */

describe('regenerateProgram when the days a week change', () => {
  let db: SqlExecutor;
  let program: Program;
  let threeDays: Athlete;
  let weekOneId: string;
  let weekOneBefore: WeekRows;
  let sessionIdsBefore: Set<string>;

  beforeAll(async () => {
    db = await openMigratedTestDb();
    const built = await buildTestProgram(db);
    program = built.program;

    const weeks = await listWeeks(db, program.id);
    weekOneId = weeks[0]?.id ?? '';
    await trainWeek(db, weekOneId, TODAY);
    weekOneBefore = await weekRows(db, weekOneId);
    sessionIdsBefore = new Set(
      (await db.getAllAsync<{ id: string }>('SELECT id FROM session')).map((row) => row.id),
    );

    // The hook writes the patch before it re-plans, so the test does too.
    threeDays = await upsertAthlete(db, { daysPerWeek: 3, weekdays: [1, 3, 5] });
  });

  it('rebuilds every week from the second on, in one version', async () => {
    const result = await regenerateProgram(db, {
      athlete: threeDays,
      pain: [],
      program,
      changes: DAYS_CHANGE,
      fromWeek: 2,
      today: TODAY,
      baseline: BASELINE,
    });
    expect(result.fromWeek).toBe(2);
    expect(result.rebuiltWeeks).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(result.versionNumber).toBe(2);
  });

  it('leaves the trained week exactly as it was, row for row', async () => {
    expect(await weekRows(db, weekOneId)).toEqual(weekOneBefore);
  });

  it('writes three sessions a week from week 2, under new ids', async () => {
    const weeks = await listWeeks(db, program.id);
    expect(await listSessionsByWeek(db, weekOneId, TODAY)).toHaveLength(4);
    for (const week of weeks.slice(1)) {
      const sessions = await listSessionsByWeek(db, week.id, TODAY);
      expect(sessions).toHaveLength(3);
      for (const session of sessions) {
        expect(sessionIdsBefore.has(session.id)).toBe(false);
        expect(session.loggedSetCount).toBe(0);
      }
      // 'revision', not 'projection': these weeks folded a real week in, and
      // `isProjectedWeek` reads both as written ahead of the athlete anyway.
      expect(week.generatedBy).toBe('revision');
    }
  });

  it('writes exactly one new version row, carrying the plan it ended on', async () => {
    const versions = await versionRows(db, program.id);
    expect(versions.map((row) => row.reason)).toEqual(['first build', 'days a week changed']);
    const layout = JSON.parse(versions[1]?.week_layout ?? 'null') as {
      fromWeek: number;
      skeleton: { daysPerWeek: number };
      changedFields: string[];
      rebuiltWeeks: number[];
    };
    expect(layout.fromWeek).toBe(2);
    expect(layout.changedFields).toEqual(['daysPerWeek']);
    expect(layout.rebuiltWeeks).toHaveLength(11);
    expect(layout.skeleton.daysPerWeek).toBe(3);
  });

  it('brings the stored plan forward, so the Plan draws the new calendar', async () => {
    const saved = await getProgram(db, program.id);
    expect(readSkeleton(saved?.snapshot ?? null)?.daysPerWeek).toBe(3);
  });

  it('leaves the automatic revision nothing to do', async () => {
    const versions = await versionRows(db, program.id);
    const weeks = await listWeeks(db, program.id);
    const target = revisionTarget({
      weeks: weeks.map((week) => ({
        w: week.w,
        windowStart: week.windowStart,
        windowEnd: week.windowEnd,
        loggedSets: week.w === 1 ? 12 : 0,
        startedSessions: week.w === 1 ? 4 : 0,
      })),
      today: TODAY,
      latestReason: versions[1]?.reason,
      latestLayout: JSON.parse(versions[1]?.week_layout ?? 'null') as never,
    });
    // The reason is "days a week changed", which is not a "revised from week N"
    // sentence, so the layout is the only thing that can say the fold already
    // reached week 1. Without it Today would revise over these weeks at once.
    expect(target.projectedFrom).toBe(1);
    expect(target.shouldRevise).toBe(false);
  });

  it('does nothing when the revision runs anyway', async () => {
    const saved = await getProgram(db, program.id);
    const weeksBefore = await listWeeks(db, program.id);
    const again = await reviseProgram(db, {
      athlete: toEngineAthlete({ athlete: threeDays, pains: [], baseline: BASELINE }),
      program: saved ?? program,
      today: TODAY,
    });
    expect(again.revisedWeeks).toEqual([]);
    expect(again.versionNumber).toBeNull();
    expect(await listWeeks(db, program.id)).toEqual(weeksBefore);
    expect(await versionRows(db, program.id)).toHaveLength(2);
  });

  it('still revises once a further week is really trained', async () => {
    const weeks = await listWeeks(db, program.id);
    const day = weeks[1]?.windowEnd ?? TODAY;
    await trainWeek(db, weeks[1]?.id ?? '', day);
    const saved = await getProgram(db, program.id);
    const result = await reviseProgram(db, {
      athlete: toEngineAthlete({ athlete: threeDays, pains: [], baseline: BASELINE }),
      program: saved ?? program,
      today: day,
    });
    expect(result.revisedWeeks[0]).toBe(3);
    expect(result.versionNumber).toBe(3);
  });
});

/* ------------------------------------------ moving down a training age */

describe('regenerateProgram when the training age changes', () => {
  let ageDb: SqlExecutor;
  let ageProgram: Program;
  let younger: Athlete;
  let weekOneCap: number;
  let weekTwoCapBefore: number;

  beforeAll(async () => {
    ageDb = await openMigratedTestDb();
    const built = await buildTestProgram(ageDb);
    ageProgram = built.program;
    const weeks = await listWeeks(ageDb, ageProgram.id);
    await trainWeek(ageDb, weeks[0]?.id ?? '', TODAY);
    weekOneCap = await topPercent(ageDb, weeks[0]?.id ?? '');
    weekTwoCapBefore = await topPercent(ageDb, weeks[1]?.id ?? '');
    // "4+ yrs" to "1-3 yrs". `toEngineAthlete` derives the level from the
    // years, so this one column moves the whole prescription.
    younger = await upsertAthlete(ageDb, { trainingAgeYears: 2 });
  });

  it('re-prescribes the unstarted weeks under the lower top-set cap', async () => {
    const result = await regenerateProgram(ageDb, {
      athlete: younger,
      pain: [],
      program: ageProgram,
      changes: AGE_CHANGE,
      fromWeek: 2,
      today: TODAY,
      baseline: BASELINE,
    });
    expect(result.rebuiltWeeks).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

    // `levelTopSetCapPct`: 92 advanced, 87 intermediate. Nothing else about
    // the athlete moved, so the whole difference is the answer they changed.
    const weeks = await listWeeks(ageDb, ageProgram.id);
    expect(weekTwoCapBefore).toBeGreaterThan(87);
    const after = await topPercent(ageDb, weeks[1]?.id ?? '');
    expect(after).toBeLessThanOrEqual(87);
    expect(after).toBeLessThan(weekTwoCapBefore);
  });

  it('leaves the trained week prescribed exactly as it was', async () => {
    const weeks = await listWeeks(ageDb, ageProgram.id);
    expect(weeks[0]?.generatedBy).toBe('setup');
    expect(await topPercent(ageDb, weeks[0]?.id ?? '')).toBe(weekOneCap);
  });

  it('keeps every week window where the athlete already saw it', async () => {
    const weeks = await listWeeks(ageDb, ageProgram.id);
    // Re-planning at today rather than at the program start would shift the
    // whole grid a week and renumber it under the athlete.
    expect(weeks.map((week) => week.windowStart)).toEqual([
      '2026-09-07',
      '2026-09-14',
      '2026-09-21',
      '2026-09-28',
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
      '2026-10-26',
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
      '2026-11-23',
    ]);
  });
});

/* ---------------------------------------- the Monday of the first week */

describe('regenerateProgram on the first day of week 1', () => {
  let dayOneDb: SqlExecutor;
  let dayOneProgram: Program;
  let threeDays: Athlete;
  let sessionIdsBefore: Set<string>;
  /** Week 1 opens on Monday 7 Sep 2026. Nothing has been logged anywhere. */
  const MONDAY = '2026-09-07';

  beforeAll(async () => {
    dayOneDb = await openMigratedTestDb();
    const built = await buildTestProgram(dayOneDb);
    dayOneProgram = built.program;
    sessionIdsBefore = new Set(
      (await dayOneDb.getAllAsync<{ id: string }>('SELECT id FROM session')).map((row) => row.id),
    );
    threeDays = await upsertAthlete(dayOneDb, { daysPerWeek: 3, weekdays: [1, 3, 5] });
  });

  it('offers to rebuild week 1 itself, because nothing in it has been done', async () => {
    const facts = await readWeekFacts(dayOneDb, dayOneProgram.id, MONDAY);
    const fromWeek = nextUnstartedWeek(
      facts.map((fact) => ({
        w: fact.row.w,
        windowStart: fact.row.windowStart,
        windowEnd: fact.row.windowEnd,
        loggedSets: fact.loggedSets,
        startedSessions: fact.startedSessions,
      })),
      MONDAY,
    );
    expect(fromWeek).toBe(1);
  });

  it('replaces week 1s sessions with ones the new answer wrote', async () => {
    const result = await regenerateProgram(dayOneDb, {
      athlete: threeDays,
      pain: [],
      program: dayOneProgram,
      changes: DAYS_CHANGE,
      fromWeek: 1,
      today: MONDAY,
      baseline: BASELINE,
    });
    expect(result.rebuiltWeeks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

    const weeks = await listWeeks(dayOneDb, dayOneProgram.id);
    const sessions = await listSessionsByWeek(dayOneDb, weeks[0]?.id ?? '', MONDAY);
    expect(sessions).toHaveLength(3);
    for (const session of sessions) expect(sessionIdsBefore.has(session.id)).toBe(false);
    // Monday, Wednesday, Friday of week 1: the days the athlete just picked,
    // in the week they are standing in.
    expect(sessions.map((session) => session.scheduledDate)).toEqual([
      '2026-09-07',
      '2026-09-09',
      '2026-09-11',
    ]);
    expect(weeks[0]?.generatedBy).toBe('revision');
  });

  it('leaves nothing behind on the old answer', async () => {
    for (const week of await listWeeks(dayOneDb, dayOneProgram.id)) {
      const sessions = await listSessionsByWeek(dayOneDb, week.id, MONDAY);
      expect(sessions).toHaveLength(3);
      for (const session of sessions) expect(sessionIdsBefore.has(session.id)).toBe(false);
    }
  });
});

/* ------------------------------------------------ a rebuild that fails */

/**
 * An executor that lets one week's write fail, and nothing else.
 *
 * The write is the only place a real regeneration can die halfway. What must
 * not happen is that the attempt still counts as a finished rebuild, because
 * the version row it would leave behind is what tells the automatic revision
 * there is nothing left to repair.
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

describe('regenerateProgram when a week write fails', () => {
  let failDb: SqlExecutor;
  let failProgram: Program;
  let patched: Athlete;

  beforeAll(async () => {
    failDb = await openMigratedTestDb();
    const built = await buildTestProgram(failDb);
    failProgram = built.program;
    const weeks = await listWeeks(failDb, failProgram.id);
    await trainWeek(failDb, weeks[0]?.id ?? '', TODAY);
    patched = await upsertAthlete(failDb, { daysPerWeek: 3, weekdays: [1, 3, 5] });
  });

  it('keeps the engines sentence and writes no version row', async () => {
    const input = {
      athlete: patched,
      pain: [],
      program: failProgram,
      changes: DAYS_CHANGE,
      fromWeek: 2,
      today: TODAY,
      baseline: BASELINE,
    };
    await expect(regenerateProgram(failingOnWeek(failDb, 3), input)).rejects.toThrow(
      RegenerationFailedError,
    );
    await expect(regenerateProgram(failingOnWeek(failDb, 3), input)).rejects.toThrow('disk full');

    const versions = await versionRows(failDb, failProgram.id);
    expect(versions.map((row) => row.reason)).toEqual(['first build']);
  });

  it('leaves the automatic revision armed, so the half-written plan is repaired', async () => {
    const versions = await versionRows(failDb, failProgram.id);
    const weeks = await listWeeks(failDb, failProgram.id);
    const target = revisionTarget({
      weeks: weeks.map((week) => ({
        w: week.w,
        windowStart: week.windowStart,
        windowEnd: week.windowEnd,
        loggedSets: week.w === 1 ? 12 : 0,
        startedSessions: week.w === 1 ? 4 : 0,
      })),
      today: TODAY,
      latestReason: versions[versions.length - 1]?.reason,
      latestLayout: JSON.parse(versions[versions.length - 1]?.week_layout ?? 'null') as never,
    });
    expect(target.shouldRevise).toBe(true);
    expect(target.fromWeek).toBe(2);
  });

  it('finishes the rebuild once the write works again', async () => {
    const result = await regenerateProgram(failDb, {
      athlete: patched,
      pain: [],
      program: failProgram,
      changes: DAYS_CHANGE,
      fromWeek: 2,
      today: TODAY,
      baseline: BASELINE,
    });
    expect(result.rebuiltWeeks).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const week of (await listWeeks(failDb, failProgram.id)).slice(1)) {
      expect(await listSessionsByWeek(failDb, week.id, TODAY)).toHaveLength(3);
    }
  });
});
