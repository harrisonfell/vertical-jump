import { beforeEach, describe, expect, it } from 'vitest';
import type { SqlExecutor } from '../executor';
import { openMigratedTestDb } from '../testing/testDb';
import { upsertAthlete } from './athlete';
import { createProgram, getWeek, upsertWeek } from './program';

/**
 * The week upsert, which every path in the app writes through: the build, a
 * revision, the backfill, and finishing a workout.
 *
 * Those callers pass different subsets of the row. Finishing a week's last
 * workout upserts the *next* week to carry its ladder rungs forward, and knows
 * nothing about how that week was generated or what its targets are; the build
 * and a revision pass all of it. Writing `?? null` for what a caller omitted
 * meant the first path silently blanked the second path's columns, so a
 * projected week stopped saying it was projected the moment the week before it
 * was finished.
 */

const START = '2026-09-07';

let db: SqlExecutor;

async function seedProgram(): Promise<string> {
  await upsertAthlete(db, { timezone: 'America/New_York', rolloverHour: 4 });
  const { program } = await createProgram(db, {
    rulesetVersion: 'v1',
    seed: 'seed',
    startDate: START,
    endDate: '2026-11-29',
    snapshot: { note: 'test' },
    weekLayout: { weeks: 12 },
  });
  return program.id;
}

beforeEach(async () => {
  db = await openMigratedTestDb();
});

describe('upsertWeek', () => {
  it('keeps every column a partial upsert says nothing about', async () => {
    const programId = await seedProgram();

    const full = await upsertWeek(db, {
      programId,
      w: 2,
      windowStart: '2026-09-14',
      windowEnd: '2026-09-20',
      kind: 'load',
      k: 3,
      prescribedCount: 4,
      repeatOfWeek: 1,
      extensiveTarget: 120,
      highContactAllowance: 40,
      ladderRungs: { squat_ladder: 2 },
      snapshot: { w: 2, note: 'the projection' },
      generatedAt: '2026-09-04T12:00:00.000Z',
      generatedBy: 'projection',
    });
    expect(full.generatedBy).toBe('projection');

    // Exactly what finishing the previous week's last workout writes.
    await upsertWeek(db, {
      programId,
      w: 2,
      windowStart: '2026-09-14',
      windowEnd: '2026-09-20',
      kind: 'load',
      k: 3,
      prescribedCount: 4,
      ladderRungs: { squat_ladder: 3 },
      snapshot: { w: 2, note: 'the projection' },
    });

    const kept = await getWeek(db, programId, 2);
    expect(kept?.id).toBe(full.id);
    expect(kept?.generatedBy).toBe('projection');
    expect(kept?.generatedAt).toBe('2026-09-04T12:00:00.000Z');
    expect(kept?.extensiveTarget).toBe(120);
    expect(kept?.highContactAllowance).toBe(40);
    expect(kept?.repeatOfWeek).toBe(1);
    expect(kept?.programVersionId).toBe(full.programVersionId);
    // And the fields the caller did pass still land.
    expect(kept?.ladderRungs).toEqual({ squat_ladder: 3 });
  });

  it('still clears a column that is passed as null', async () => {
    const programId = await seedProgram();
    const week = {
      programId,
      w: 3,
      windowStart: '2026-09-21',
      windowEnd: '2026-09-27',
      kind: 'load',
    } as const;

    await upsertWeek(db, { ...week, repeatOfWeek: 2, generatedBy: 'projection' });
    // A revision writes `repeatOfWeek: plan.repeatOfWeek ?? null`, so a week
    // that has stopped being a repeat of another has to be able to say so.
    await upsertWeek(db, { ...week, repeatOfWeek: null, generatedBy: 'revision' });

    const saved = await getWeek(db, programId, 3);
    expect(saved?.repeatOfWeek).toBeNull();
    expect(saved?.generatedBy).toBe('revision');
  });

  it('leaves a week that was never written before with plain nulls', async () => {
    const programId = await seedProgram();
    await upsertWeek(db, {
      programId,
      w: 4,
      windowStart: '2026-09-28',
      windowEnd: '2026-10-04',
      kind: 'load',
    });

    const saved = await getWeek(db, programId, 4);
    expect(saved?.generatedBy).toBeNull();
    expect(saved?.extensiveTarget).toBeNull();
    expect(saved?.prescribedCount).toBe(0);
  });
});
