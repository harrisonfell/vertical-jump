/**
 * Block 6 on added load and on the climbing owner's entered numbers: the
 * weighted pull-up's "5 x BW + 45 lb" rows, the box squat's worked ladder off
 * the entered 320 lb, the ballistic ceiling the loaded jumps take, and the
 * entered revision that retires a stale 345 lb.
 */
import { describe, expect, it } from 'vitest';
import { indexById, loadExercises } from '../exercises/index.js';
import { kgToLb, lbToKg } from '../units.js';
import { getPerSetPrescription } from './index.js';
import { addedLoadFirstFreeze, usesAddedLoad, withAddedLoadDisplay } from './pullUp.js';
import {
  enteredMaxCandidate,
  enteredRevisionApplies,
  resolveWorkingMax,
  resolveWorkingMaxWithEntry,
  type EnteredOneRm,
} from './workingMax.js';
import { RULES, displays, makeAthlete, makeContext, makeLog, makeWorkingMax } from './prescribe.fixtures.test.js';
import type { Exercise } from '../types/exercise.js';
import type { SetLog } from '../types/logs.js';

const { exercises } = loadExercises();
const byId = indexById(exercises);

function seeded(id: string): Exercise {
  const exercise = byId.get(id);
  if (exercise === undefined) throw new Error(`seed is missing ${id}`);
  return exercise;
}

const PULL_UP = seeded('weighted_pull_up');
const CLUSTER = seeded('weighted_pull_up_cluster');
const BOX_SQUAT = seeded('box_squat');
const BARBELL_JUMP = seeded('barbell_jump');
const JUMP_SQUAT = seeded('jump_squat');

const ADVANCED = makeAthlete('advanced');

describe('added-load rows (house.sc.upper_power_day)', () => {
  it('recognizes the weighted pull-up and its cluster, and nothing else', () => {
    expect(usesAddedLoad(PULL_UP)).toBe(true);
    expect(usesAddedLoad(CLUSTER)).toBe(true);
    expect(usesAddedLoad(BOX_SQUAT)).toBe(false);
    expect(usesAddedLoad(seeded('pull_up'))).toBe(false);
    expect(usesAddedLoad(seeded('db_row'))).toBe(false);
    expect(exercises.filter(usesAddedLoad).map((entry) => entry.id)).toEqual([
      'weighted_pull_up',
      'weighted_pull_up_cluster',
    ]);
  });

  it('shows the added load only, on the 5 lb grid', () => {
    const sets = getPerSetPrescription(
      PULL_UP,
      ADVANCED,
      makeContext({ sets: 4, workingMax: makeWorkingMax('weighted_pull_up', 60) }),
    );
    // 75, 80, 85 and 90 percent of a 60 lb added-load max: 45, 48, 51, 54,
    // each snapped to the 5 lb grid, and the reps descend 5 / 4 / 3 / 3.
    expect(displays(sets)).toEqual([
      '5 × BW + 45 lb',
      '4 × BW + 50 lb',
      '3 × BW + 50 lb',
      '3 × BW + 55 lb',
    ]);
    expect(sets.map((set) => set.loadPercent)).toEqual([75, 80, 85, 90]);
    // Bodyweight is not in the number: the row carries the added load alone.
    expect(kgToLb(sets[0]?.loadKg ?? 0)).toBeCloseTo(45, 6);
  });

  it('reads "5 × BW" when the grid rounds the added load to nothing', () => {
    const sets = getPerSetPrescription(
      PULL_UP,
      ADVANCED,
      makeContext({ sets: 2, workingMax: makeWorkingMax('weighted_pull_up', 2) }),
    );
    // Two sets take the first and the last rep of the 5 / 4 / 3 descent.
    expect(displays(sets)).toEqual(['5 × BW', '3 × BW']);
  });

  it('holds the top set at the advanced cap (R154 with R155)', () => {
    const sets = getPerSetPrescription(
      PULL_UP,
      ADVANCED,
      makeContext({ sets: 5, workingMax: makeWorkingMax('weighted_pull_up', 60) }),
    );
    expect(sets.map((set) => set.loadPercent)).toEqual([75, 80, 85, 90, 90]);
    expect(sets.map((set) => set.isHeld)).toEqual([false, false, false, false, true]);
    expect(displays(sets).at(-1)).toBe('3 × BW + 55 lb');
  });

  it('runs RPE mode when the lift has no history (R74, R158)', () => {
    const sets = getPerSetPrescription(PULL_UP, ADVANCED, makeContext({ sets: 3 }));
    expect(displays(sets)).toEqual([
      '5 reps · RPE 6 · __ lb',
      '4 reps · RPE 7 · __ lb',
      '3 reps · RPE 8 · __ lb',
    ]);
    expect(sets.every((set) => set.loadKg === undefined)).toBe(true);
  });

  it('gives the cluster the same scheme and a cue of its own', () => {
    const context = makeContext({ sets: 3, workingMax: makeWorkingMax('weighted_pull_up', 60) });
    const plain = getPerSetPrescription(PULL_UP, ADVANCED, context);
    const cluster = getPerSetPrescription(CLUSTER, ADVANCED, context);
    expect(displays(cluster)).toEqual(displays(plain));
    expect(cluster.map((set) => set.loadPercent)).toEqual(plain.map((set) => set.loadPercent));
    expect(CLUSTER.cues.some((cue) => cue.toLowerCase().includes('cluster'))).toBe(true);
    expect(CLUSTER.loadType).toBe(PULL_UP.loadType);
  });

  it('keeps the notation through a soreness reduction (R27)', () => {
    const sets = getPerSetPrescription(
      PULL_UP,
      ADVANCED,
      makeContext({
        sets: 2,
        workingMax: makeWorkingMax('weighted_pull_up', 60),
        sorenessToday: 8,
      }),
    );
    // R27 adds 2 reps and takes 10 percentage points off the row's own load.
    expect(displays(sets)).toEqual(['7 × BW + 40 lb', '5 × BW + 45 lb']);
    expect(displays(sets.map((set) => set.original ?? set))).toEqual([
      '5 × BW + 45 lb',
      '3 × BW + 50 lb',
    ]);
  });

  it('leaves an unloaded row alone', () => {
    const rows = getPerSetPrescription(seeded('pull_up'), ADVANCED, makeContext({ sets: 2 }));
    expect(withAddedLoadDisplay(rows)).toEqual(rows);
  });
});

describe('the added-load working max', () => {
  it('estimates from added load alone (R73 on the added load)', () => {
    const logs: SetLog[] = [
      makeLog({
        id: 'p1',
        exerciseId: 'weighted_pull_up',
        repsDone: 5,
        loadKg: lbToKg(30),
        completedAt: '2026-09-08T18:20:00.000Z',
      }),
      makeLog({
        id: 'p2',
        exerciseId: 'weighted_pull_up',
        repsDone: 3,
        loadKg: lbToKg(40),
        rpe: 8,
        completedAt: '2026-09-08T18:26:00.000Z',
      }),
    ];
    const max = resolveWorkingMax(
      'weighted_pull_up',
      PULL_UP,
      undefined,
      null,
      logs,
      RULES,
      '2026-09-14T03:00:00.000Z',
    );
    // Epley on 40 lb x 3 is 44 lb, confirmed by the RPE 8 set, so no 0.95
    // factor: the working max is 45 lb of ADDED load, nowhere near a
    // bodyweight-inclusive number.
    expect(kgToLb(max.valueKg)).toBeCloseTo(45, 6);
    expect(max.source).toBe('epley');
    expect(max.confidence).toBe(1);
  });

  it('takes the first freeze from an entered rep max', () => {
    const entered: EnteredOneRm = {
      valueKg: lbToKg(45),
      reps: 5,
      enteredAt: '2026-09-05T12:00:00.000Z',
    };
    const max = addedLoadFirstFreeze('weighted_pull_up', entered, RULES, '2026-09-07T03:00:00.000Z');
    // Epley on 45 lb x 5 is 52.5 lb, times the 0.95 confidence factor is
    // 49.875, which lands on 50 lb.
    expect(kgToLb(max.valueKg)).toBeCloseTo(50, 6);
    expect(max.source).toBe('epley');
    expect(max.confidence).toBe(RULES.constants.workingMax.epleyConfidence);
  });

  it('takes an entered single straight through (R72)', () => {
    const candidate = enteredMaxCandidate(
      { valueKg: lbToKg(60), reps: 1, enteredAt: '2026-09-05T12:00:00.000Z' },
      RULES,
    );
    expect(kgToLb(candidate.valueKg)).toBeCloseTo(60, 6);
    expect(candidate.source).toBe('entered');
    expect(candidate.confidence).toBe(1);
  });
});

describe('the box squat off the entered 320 lb', () => {
  const context = (sets: number): ReturnType<typeof makeContext> =>
    makeContext({ sets, workingMax: makeWorkingMax('box_squat', 320) });

  it('runs 5 × 240, 4 × 255, 3 × 270', () => {
    const sets = getPerSetPrescription(BOX_SQUAT, ADVANCED, context(3));
    expect(displays(sets)).toEqual(['5 × 240 lb', '4 × 255 lb', '3 × 270 lb']);
  });

  it('holds the top set once the ladder reaches the advanced cap', () => {
    const sets = getPerSetPrescription(BOX_SQUAT, ADVANCED, context(5));
    expect(displays(sets)).toEqual([
      '5 × 240 lb',
      '4 × 255 lb',
      '3 × 270 lb',
      '3 × 290 lb',
      '3 × 290 lb',
    ]);
    expect(sets.at(-1)?.isHeld).toBe(true);
  });

  it('ramps a 7-set day at 190 and 225 (R71, R157)', () => {
    const sets = getPerSetPrescription(BOX_SQUAT, ADVANCED, context(7));
    expect(sets.map((set) => Math.round(kgToLb(set.loadKg ?? 0)))).toEqual([
      190, 225, 240, 255, 270, 290, 290,
    ]);
    expect(sets.map((set) => set.isRamp)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(sets.map((set) => set.setNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(sets[0]?.restS).toBe(240);
  });
});

describe('the loaded jumps off the same squat max', () => {
  const squatWorkingMax = makeWorkingMax('box_squat', 320);

  it('caps the barbell jump at 30 percent, rounded down', () => {
    const sets = getPerSetPrescription(
      BARBELL_JUMP,
      ADVANCED,
      makeContext({ sets: 3, squatWorkingMax }),
    );
    // 30 percent of 320 lb is 96 lb, and a ballistic load always rounds down.
    expect(displays(sets)).toEqual(['3 × 95 lb', '3 × 95 lb', '3 × 95 lb']);
    expect(sets.every((set) => set.loadPercent === 30)).toBe(true);
  });

  it('caps the jump squat at the same ceiling when it runs ballistic', () => {
    const sets = getPerSetPrescription(
      JUMP_SQUAT,
      ADVANCED,
      makeContext({ sets: 3, squatWorkingMax, loadTypeOverride: 'ballistic' }),
    );
    expect(displays(sets)).toEqual(['3 × 95 lb', '3 × 95 lb', '3 × 95 lb']);
    expect(JUMP_SQUAT.ballisticCapPct).toBe(30);
  });
});

describe('an entered revision retires a stale working max (R72)', () => {
  const stale = makeWorkingMax('box_squat', 345, {
    source: 'epley',
    confidence: 0.95,
    frozenAt: '2026-08-31T03:00:00.000Z',
    lastRaiseAt: '2026-08-31T03:00:00.000Z',
    failStreak: 1,
  });
  const revision: EnteredOneRm = {
    valueKg: lbToKg(320),
    reps: 1,
    enteredAt: '2026-09-05T12:00:00.000Z',
  };
  const asOf = '2026-09-07T03:00:00.000Z';

  it('is what the monotone rule alone would refuse', () => {
    const kept = resolveWorkingMax(
      'box_squat',
      BOX_SQUAT,
      stale,
      revision.valueKg,
      [],
      RULES,
      asOf,
    );
    expect(Math.round(kgToLb(kept.valueKg))).toBe(345);
  });

  it('replaces the stale value at the next freeze', () => {
    const revised = resolveWorkingMaxWithEntry(
      'box_squat',
      BOX_SQUAT,
      stale,
      revision,
      [],
      RULES,
      asOf,
    );
    expect(Math.round(kgToLb(revised.valueKg))).toBe(320);
    expect(revised.source).toBe('entered');
    expect(revised.confidence).toBe(1);
    expect(revised.frozenAt).toBe(asOf);
    expect(revised.failStreak).toBe(0);
    expect(enteredRevisionApplies(stale, revision)).toBe(true);
  });

  it('leaves the stored value alone when the entry is older than the freeze', () => {
    const older: EnteredOneRm = { ...revision, enteredAt: '2026-08-01T12:00:00.000Z' };
    const kept = resolveWorkingMaxWithEntry(
      'box_squat',
      BOX_SQUAT,
      stale,
      older,
      [],
      RULES,
      asOf,
    );
    expect(Math.round(kgToLb(kept.valueKg))).toBe(345);
    expect(enteredRevisionApplies(stale, older)).toBe(false);
  });

  it('does not re-apply itself the week after, so an R97 drop survives', () => {
    const dropped = makeWorkingMax('box_squat', 305, {
      source: 'entered',
      frozenAt: '2026-09-14T03:00:00.000Z',
      failStreak: 1,
    });
    const next = resolveWorkingMaxWithEntry(
      'box_squat',
      BOX_SQUAT,
      dropped,
      revision,
      [],
      RULES,
      '2026-09-21T03:00:00.000Z',
    );
    expect(Math.round(kgToLb(next.valueKg))).toBe(305);
    expect(next.failStreak).toBe(1);
  });

  it('prescribes the revised number, never the stale one', () => {
    const revised = resolveWorkingMaxWithEntry(
      'box_squat',
      BOX_SQUAT,
      stale,
      revision,
      [],
      RULES,
      asOf,
    );
    const sets = getPerSetPrescription(
      BOX_SQUAT,
      ADVANCED,
      makeContext({ sets: 3, workingMax: revised }),
    );
    expect(displays(sets)).toEqual(['5 × 240 lb', '4 × 255 lb', '3 × 270 lb']);
  });
});
