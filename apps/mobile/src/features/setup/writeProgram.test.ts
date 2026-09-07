import { beforeAll, describe, expect, it } from 'vitest';
import { inToMm, lbToKg } from '@vert/engine';
import type { SqlExecutor } from '../../data';
import { openMigratedTestDb } from '../../data/testing/testDb';
import { upsertAthlete } from '../../data/store/athlete';
import {
  getCurrentProgram,
  getLatestProgramVersion,
  listBlocks,
  listWeeks,
} from '../../data/store/program';
import { listSessionExercises, listSessionsByWeek } from '../../data/store/sessions';
import type { Athlete } from '../../data/types';
import { buildProgramPlan, type BuildPlan } from './buildProgram';
import { buildStepCount, writeStepCount, type WriteProgress } from './buildProgress';
import { writeProgramPlan } from './writeProgram';

/**
 * The write half, against the same sql.js engine the web build runs on.
 *
 * Every week is written whole: the week row with the engine's `WeekPlan` as
 * its snapshot, then every session with its exercise rows and per-set
 * prescriptions. Week 1 is materialized from the answers, weeks 2 to W are
 * projected from it, and `generated_by` is the only thing that separates them.
 */

const TODAY = '2026-09-04';

const CLEAR = {
  heartCondition: false,
  chestPain: false,
  dizziness: false,
  chronicCondition: false,
  prescriptionMedication: false,
  boneOrJointProblem: false,
  supervisedActivityOnly: false,
  isAdult: true,
  attestedAt: TODAY,
};

const INVENTORY = {
  barbell: true,
  rack: true,
  plates: { smallestPairLb: 5 },
  trapBar: true,
  dumbbells: { maxLb: 100, incrementLb: 5 },
  kettlebells: false,
  boxHeightsIn: [12, 18, 24, 30],
  hurdleHeightsIn: [6, 9, 12],
  bands: true,
  medBall: true,
  vestLb: 20,
  bench: true,
  pullupBar: true,
  cable: false,
  sled: false,
};

let db: SqlExecutor;
let athlete: Athlete;
let plan: BuildPlan;
let programId: string;

beforeAll(async () => {
  db = await openMigratedTestDb();
  athlete = await upsertAthlete(db, {
    primaryGoal: 'vertical_jump',
    sport: 'basketball',
    trainingAgeYears: 5,
    level: 'advanced',
    daysPerWeek: 4,
    weekdays: [1, 2, 4, 6],
    isAdult: true,
    clearance: CLEAR,
    inventory: INVENTORY,
    weightRoomAccess: true,
    bodyweightKg: lbToKg(181),
    workingMax: {
      back_squat: {
        exerciseId: 'back_squat',
        valueKg: lbToKg(275),
        source: 'entered',
        confidence: 1,
        frozenAt: `${TODAY}T03:00:00.000Z`,
        lastRaiseAt: null,
      },
    },
    goalHeightMm: inToMm(36),
    targetDate: '2026-11-29',
    timezone: 'America/New_York',
    rolloverHour: 3,
  });

  plan = buildProgramPlan({
    athlete,
    pains: [],
    baseline: { heightMm: inToMm(29.4), instrument: 'ovr_jump_regular' },
    today: TODAY,
    generatedAt: `${TODAY}T12:00:00.000Z`,
  });
  programId = await writeProgramPlan(db, plan);
});

describe('writeProgramPlan', () => {
  it('writes one active program with its first version and its blocks', async () => {
    const program = await getCurrentProgram(db);
    expect(program?.id).toBe(programId);
    expect(program?.status).toBe('active');
    expect(program?.startDate).toBe('2026-09-07');
    expect(program?.seed).toBe(String(plan.seed));

    const version = await getLatestProgramVersion(db, programId);
    expect(version?.version).toBe(1);

    const blocks = await listBlocks(db, programId);
    expect(blocks.map((block) => block.type)).toEqual(['strength', 'power']);
  });

  it('writes every week with a snapshot, week 1 from setup and the rest projected', async () => {
    const weeks = await listWeeks(db, programId);
    expect(weeks).toHaveLength(12);
    expect(weeks.map((week) => week.w)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

    for (const week of weeks) {
      expect(week.snapshot).not.toBeNull();
      expect(week.generatedAt).not.toBeNull();
      expect(week.prescribedCount).toBeGreaterThan(0);
    }

    expect(weeks[0]?.generatedBy).toBe('setup');
    expect(weeks[0]?.kind).toBe('load');
    expect(weeks[6]?.generatedBy).toBe('projection');
    expect(weeks.map((week) => week.generatedBy)).toEqual([
      'setup',
      ...Array.from({ length: 11 }, () => 'projection'),
    ]);

    expect(weeks.some((week) => week.kind === 'deload')).toBe(true);
    expect(weeks[11]?.kind).toBe('peak');
  });

  it('writes every session of every week, not just week 1', async () => {
    const weeks = await listWeeks(db, programId);
    const counts: number[] = [];
    for (const week of weeks) {
      counts.push((await listSessionsByWeek(db, week.id, TODAY)).length);
    }
    expect(counts).toHaveLength(12);
    expect(counts[0]).toBe(4);
    expect(counts[6]).toBe(4);
    // The taper week prescribes fewer, and the write follows the plan, not a
    // constant four a week.
    expect(counts[11]).toBe(3);
    expect(counts.every((count) => count > 0)).toBe(true);

    const total = counts.reduce((sum, count) => sum + count, 0);
    expect(total).toBe(plan.weeks.reduce((sum, week) => sum + week.sessions.length, 0));
    expect(counts).toEqual(plan.weeks.map((week) => week.sessions.length));
  });

  it('gives a projected week its own sessions, with exercise rows behind them', async () => {
    const weeks = await listWeeks(db, programId);
    const seventh = weeks[6];
    expect(seventh?.generatedBy).toBe('projection');

    const sessions = await listSessionsByWeek(db, seventh?.id ?? '', TODAY);
    expect(sessions.map((session) => session.scheduledDate)).toEqual(
      plan.weeks[6]?.sessions.map((session) => session.date),
    );
    for (const session of sessions) {
      expect(session.status).toBe('planned');
      expect(session.prescribedSetCount).toBeGreaterThan(0);
      const rows = await listSessionExercises(db, session.id);
      expect(rows.length).toBeGreaterThan(0);
    }
  });

  it('writes week 1 sessions with their day types in the words the app uses', async () => {
    const weeks = await listWeeks(db, programId);
    const weekId = weeks[0]?.id ?? '';
    const sessions = await listSessionsByWeek(db, weekId, TODAY);
    expect(sessions.map((session) => session.dayType)).toEqual([
      'Lower Strength',
      'Upper Strength',
      'Power + Speed',
      'Recovery - Mobility',
    ]);
    expect(sessions.map((session) => session.scheduledDate)).toEqual([
      '2026-09-07',
      '2026-09-08',
      '2026-09-10',
      '2026-09-12',
    ]);
    for (const session of sessions) {
      expect(session.status).toBe('planned');
      expect(session.prescribedSetCount).toBeGreaterThan(0);
    }
  });

  it('writes the per-set prescriptions the runner renders, row for row', async () => {
    const weeks = await listWeeks(db, programId);
    const sessions = await listSessionsByWeek(db, weeks[0]?.id ?? '', TODAY);
    const lower = sessions[0];
    expect(lower).toBeDefined();

    const exercises = await listSessionExercises(db, lower?.id ?? '');
    expect(exercises.length).toBeGreaterThan(0);
    expect(exercises.map((row) => row.orderIndex)).toEqual(
      exercises.map((_row, index) => index),
    );

    const squat = exercises.find((row) => row.exerciseId === 'back_squat');
    expect(squat).toBeDefined();
    expect(squat?.exerciseName).toBe('Back squat');
    expect(Array.isArray(squat?.perSet)).toBe(true);

    const sets = squat?.perSet as { displayLoad: string; restS: number }[];
    expect(sets.length).toBeGreaterThan(0);
    // The one place a load reaches the screen: the engine's own display string.
    expect(sets[0]?.displayLoad).toMatch(/lb$/);
    expect(sets[0]?.restS).toBeGreaterThan(0);
  });

  it('reports every write in order, one per step, ending at the total', async () => {
    const fresh = await openMigratedTestDb();
    await upsertAthlete(fresh, { ...athlete });
    const heard: WriteProgress[] = [];
    await writeProgramPlan(fresh, plan, (progress) => heard.push(progress));

    const sessions = plan.weeks.reduce((sum, week) => sum + week.sessions.length, 0);
    const total = writeStepCount(plan);
    expect(total).toBe(1 + 12 + sessions);
    expect(heard).toHaveLength(total);
    expect(heard.map((progress) => progress.done)).toEqual(
      heard.map((_progress, index) => index + 1),
    );
    expect(heard.every((progress) => progress.total === total)).toBe(true);
    expect(heard[total - 1]?.done).toBe(total);

    expect(heard[0]?.step).toEqual({ kind: 'program' });
    expect(heard[1]?.step).toEqual({ kind: 'week', w: 1, of: 12 });
    expect(heard[2]?.step).toEqual({ kind: 'session', w: 1, n: 1, of: 4 });
    expect(heard[5]?.step).toEqual({ kind: 'session', w: 1, n: 4, of: 4 });
    expect(heard[6]?.step).toEqual({ kind: 'week', w: 2, of: 12 });
    expect(heard[total - 1]?.step).toEqual({ kind: 'session', w: 12, n: 3, of: 3 });
  });

  it('picks the count up from the materialize phase when the screen asks it to', async () => {
    const fresh = await openMigratedTestDb();
    await upsertAthlete(fresh, { ...athlete });
    const heard: WriteProgress[] = [];
    const offset = plan.weeks.length;
    await writeProgramPlan(fresh, plan, (progress) => heard.push(progress), offset);

    const total = writeStepCount(plan) + offset;
    expect(total).toBe(buildStepCount(plan.skeleton));
    expect(heard[0]?.done).toBe(offset + 1);
    expect(heard[heard.length - 1]?.done).toBe(total);
    expect(heard.every((progress) => progress.total === total)).toBe(true);
  });
});
