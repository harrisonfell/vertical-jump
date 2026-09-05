/**
 * Block 6 worked numbers. Every expectation is quoted from brief section 09
 * "Worked numbers" or from the rule book's own Block 6 worked examples, so a
 * change to the scheme, the caps, the descent or the rounding fails here.
 */
import { describe, expect, it } from 'vitest';
import { getPerSetPrescription } from './index.js';
import {
  displays,
  makeAthlete,
  makeContext,
  makeExercise,
  makeTargets,
  makeWorkingMax,
} from './prescribe.fixtures.test.js';

const backSquat = makeExercise({ id: 'back_squat', name: 'Back squat' });
const trapBar = makeExercise({
  id: 'trap_bar_deadlift',
  name: 'Trap bar deadlift',
  movementPattern: 'hinge',
  equipment: ['trap_bar'],
});

describe('heavy strength, the ascending scheme (R150, R154, R155, R161)', () => {
  it('back squat, intermediate, 275 lb entered, 4 sets, week 2', () => {
    const athlete = makeAthlete('intermediate');
    const sets = getPerSetPrescription(
      backSquat,
      athlete,
      makeContext({ sets: 4, workingMax: makeWorkingMax('back_squat', 275) }),
    );
    expect(displays(sets)).toEqual(['5 × 205 lb', '4 × 220 lb', '3 × 235 lb', '3 × 235 lb']);
    expect(sets.map((set) => set.loadPercent)).toEqual([75, 80, 85, 85]);
    expect(sets.map((set) => set.reps)).toEqual([5, 4, 3, 3]);
    expect(sets.map((set) => set.isHeld)).toEqual([false, false, false, true]);
    expect(sets.every((set) => set.restS === 180)).toBe(true);
    expect(sets.every((set) => set.isRamp === false)).toBe(true);
  });

  it('beginner, 3 sets, holds the third set at the 80 percent cap', () => {
    const sets = getPerSetPrescription(
      backSquat,
      makeAthlete('beginner'),
      makeContext({ sets: 3, workingMax: makeWorkingMax('back_squat', 275) }),
    );
    expect(sets.map((set) => set.loadPercent)).toEqual([75, 80, 80]);
    expect(sets.map((set) => set.reps)).toEqual([5, 4, 3]);
    expect(sets[2]?.isHeld).toBe(true);
  });

  it('advanced, 7 sets: two ramp sets then five working sets, rest 4:00', () => {
    const sets = getPerSetPrescription(
      backSquat,
      makeAthlete('advanced'),
      makeContext({ sets: 7, workingMax: makeWorkingMax('back_squat', 275) }),
    );
    expect(sets.map((set) => set.loadPercent)).toEqual([60, 70, 75, 80, 85, 90, 90]);
    expect(sets.map((set) => set.reps)).toEqual([5, 5, 5, 4, 3, 3, 3]);
    expect(sets.map((set) => set.isRamp)).toEqual([true, true, false, false, false, false, false]);
    expect(sets.map((set) => set.isHeld)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
    expect(sets.map((set) => set.setNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(sets.every((set) => set.restS === 240)).toBe(true);
  });

  it('advanced may run the 5/3/1 descent (R161)', () => {
    const sets = getPerSetPrescription(
      backSquat,
      makeAthlete('advanced'),
      makeContext({
        sets: 3,
        useFiveThreeOne: true,
        workingMax: makeWorkingMax('back_squat', 275),
      }),
    );
    expect(sets.map((set) => set.reps)).toEqual([5, 3, 1]);
  });

  it('the R156 start offset raises the whole ladder', () => {
    const sets = getPerSetPrescription(
      backSquat,
      makeAthlete('intermediate'),
      makeContext({
        sets: 4,
        targets: makeTargets({ startOffsetPct: { heavy_strength: 5 } }),
        workingMax: makeWorkingMax('back_squat', 275),
      }),
    );
    expect(sets.map((set) => set.loadPercent)).toEqual([80, 85, 85, 85]);
  });
});

describe('RPE mode (R74, R158, R76)', () => {
  it('trap bar, no max, week 1 of the first program: 6, 6.5, 7 with a hard cap of 7', () => {
    const sets = getPerSetPrescription(
      trapBar,
      makeAthlete('intermediate'),
      makeContext({ w: 1, sets: 3, isFirstProgramWeek1: true }),
    );
    expect(displays(sets)).toEqual([
      '5 reps · RPE 6 · __ lb',
      '4 reps · RPE 6.5 · __ lb',
      '3 reps · RPE 7 · __ lb',
    ]);
    expect(sets.every((set) => set.loadPercent === undefined && set.loadKg === undefined)).toBe(
      true,
    );
  });

  it('week 1 holds sets 4 and 5 at RPE 7', () => {
    const sets = getPerSetPrescription(
      trapBar,
      makeAthlete('advanced'),
      makeContext({ w: 1, sets: 5, isFirstProgramWeek1: true }),
    );
    expect(sets.map((set) => set.targetRpe)).toEqual([6, 6.5, 7, 7, 7]);
  });

  it('holds sets 4 and 5 at the level RPE cap: 8, 8.5, 9', () => {
    const forLevel = (level: 'beginner' | 'intermediate' | 'advanced'): (number | undefined)[] =>
      getPerSetPrescription(trapBar, makeAthlete(level), makeContext({ sets: 5 })).map(
        (set) => set.targetRpe,
      );
    expect(forLevel('beginner')).toEqual([6, 7, 8, 8, 8]);
    expect(forLevel('intermediate')).toEqual([6, 7, 8, 8.5, 8.5]);
    expect(forLevel('advanced')).toEqual([6, 7, 8, 9, 9]);
  });
});

describe('the week-2 guard (R107, house)', () => {
  const epleyMax = makeWorkingMax('trap_bar_deadlift', 275, { source: 'epley', confidence: 0.95 });

  it('week 2 caps the top set at 80 percent when the max came from week-1 logs', () => {
    const sets = getPerSetPrescription(
      trapBar,
      makeAthlete('intermediate'),
      makeContext({ w: 2, sets: 3, isFirstPercentWeekForLift: true, workingMax: epleyMax }),
    );
    expect(displays(sets)).toEqual(['5 × 205 lb', '4 × 220 lb', '3 × 220 lb']);
    expect(sets[2]?.isHeld).toBe(true);
  });

  it('week 3 steps back up to the level cap', () => {
    const sets = getPerSetPrescription(
      trapBar,
      makeAthlete('intermediate'),
      makeContext({ w: 3, sets: 3, isFirstPercentWeekForLift: false, workingMax: epleyMax }),
    );
    expect(displays(sets)).toEqual(['5 × 205 lb', '4 × 220 lb', '3 × 235 lb']);
  });

  it('an entered 1RM is never guarded', () => {
    const sets = getPerSetPrescription(
      backSquat,
      makeAthlete('intermediate'),
      makeContext({
        sets: 3,
        isFirstPercentWeekForLift: true,
        workingMax: makeWorkingMax('back_squat', 275),
      }),
    );
    expect(sets.map((set) => set.loadPercent)).toEqual([75, 80, 85]);
  });
});

describe('the other load types', () => {
  it('DB bench, hypertrophy, week 2, working max 70 lb (R163 grid ties down)', () => {
    const dbBench = makeExercise({
      id: 'db_bench',
      name: 'Dumbbell bench press',
      loadType: 'hypertrophy',
      requiresBarbell: false,
      equipment: ['dumbbell', 'bench'],
      movementPattern: 'push_horizontal',
      isAxialLoad: false,
      isPressing: true,
      isPush: true,
      isMainLift: false,
      roleCandidates: ['secondary'],
      kneeStress: 'low',
      spineStress: 'low',
      shoulderStress: 'moderate',
    });
    const sets = getPerSetPrescription(
      dbBench,
      makeAthlete('intermediate'),
      makeContext({ sets: 3, workingMax: makeWorkingMax('db_bench', 70) }),
    );
    expect(displays(sets)).toEqual(['12 × 40 lb', '10 × 45 lb', '8 × 50 lb']);
    expect(sets.map((set) => set.loadPercent)).toEqual([60, 65, 70]);
  });

  it('power clean, advanced, ascends +10 percent: 3/2/1 at 70, 80, 90', () => {
    const powerClean = makeExercise({
      id: 'power_clean',
      name: 'Power clean',
      loadType: 'power',
      isOlympicLift: true,
      technicalSkillHigh: true,
      movementPattern: 'hinge',
    });
    const sets = getPerSetPrescription(
      powerClean,
      makeAthlete('advanced'),
      makeContext({ sets: 3, workingMax: makeWorkingMax('power_clean', 200) }),
    );
    expect(sets.map((set) => set.loadPercent)).toEqual([70, 80, 90]);
    expect(sets.map((set) => set.reps)).toEqual([3, 2, 1]);
  });

  it('goblet squat, beginner, endurance: 2 x 15 at 50 percent, straight sets', () => {
    const goblet = makeExercise({
      id: 'goblet_squat',
      name: 'Goblet squat',
      loadType: 'endurance',
      requiresBarbell: false,
      equipment: ['dumbbell'],
      isAxialLoad: false,
      isMainLift: false,
      roleCandidates: ['accessory'],
      fatigueCost: 'moderate',
    });
    const sets = getPerSetPrescription(
      goblet,
      makeAthlete('beginner'),
      makeContext({ sets: 2, workingMax: makeWorkingMax('goblet_squat', 100) }),
    );
    expect(sets.map((set) => set.loadPercent)).toEqual([50, 50]);
    expect(sets.map((set) => set.reps)).toEqual([15, 15]);
    expect(sets.every((set) => set.isHeld === false)).toBe(true);
    expect(displays(sets)).toEqual(['15 × 50 lb', '15 × 50 lb']);
  });

  it('90/90 hip switch, mobility: 2 x 8 bodyweight, no load anywhere (R159)', () => {
    const hipSwitch = makeExercise({
      id: 'hip_switch_90_90',
      name: '90/90 hip switch',
      loadType: 'mobility',
      loadable: false,
      requiresBarbell: false,
      equipment: [],
      movementPattern: 'mobility',
      isAxialLoad: false,
      intent: 'mobility',
      isMainLift: false,
      roleCandidates: ['mobility'],
      cnsCost: 'low',
      fatigueCost: 'low',
      kneeStress: 'low',
      spineStress: 'low',
    });
    const sets = getPerSetPrescription(hipSwitch, makeAthlete('beginner'), makeContext({ sets: 2 }));
    expect(displays(sets)).toEqual(['8 × BW', '8 × BW']);
    expect(sets.every((set) => set.loadPercent === undefined && set.loadKg === undefined)).toBe(
      true,
    );
    expect(sets.every((set) => set.restS === 60)).toBe(true);
  });

  it('Spanish squat isometric: 30 s holds, progressing to 35 s next week (R66)', () => {
    const spanish = makeExercise({
      id: 'spanish_squat',
      name: 'Spanish squat',
      loadType: 'prehab',
      loadable: false,
      displayMode: 'time',
      requiresBarbell: false,
      equipment: ['band'],
      holdSecondsRange: { minS: 30, maxS: 45 },
      isAxialLoad: false,
      isMainLift: false,
      roleCandidates: ['injury_prevention'],
      intent: 'prehab',
      cnsCost: 'low',
      fatigueCost: 'low',
      tendonTarget: 'knee',
      tendonMode: 'isometric',
    });
    const thisWeek = getPerSetPrescription(
      spanish,
      makeAthlete('advanced'),
      makeContext({ sets: 3, k: 0 }),
    );
    expect(displays(thisWeek)).toEqual(['30 s hold', '30 s hold', '30 s hold']);
    expect(thisWeek.every((set) => set.durationS === 30 && set.reps === undefined)).toBe(true);
    const nextWeek = getPerSetPrescription(
      spanish,
      makeAthlete('advanced'),
      makeContext({ sets: 3, k: 1 }),
    );
    expect(displays(nextWeek)).toEqual(['35 s hold', '35 s hold', '35 s hold']);
  });

  it('a sprint row shows distance, never reps or a load', () => {
    const sprint = makeExercise({
      id: 'sprint_15m',
      name: '45 degree cut and sprint',
      loadType: 'bodyweight',
      loadable: false,
      displayMode: 'distance',
      requiresBarbell: false,
      equipment: [],
      sprintDistanceM: 15,
      codCutsPerRep: 1,
      movementPattern: 'sprint',
      isAxialLoad: false,
      isMainLift: false,
      roleCandidates: ['cod'],
      intent: 'velocity',
    });
    const sets = getPerSetPrescription(sprint, makeAthlete('advanced'), makeContext({ sets: 4 }));
    expect(displays(sets)).toEqual(['15 m', '15 m', '15 m', '15 m']);
    expect(sets.every((set) => set.reps === undefined && set.loadKg === undefined)).toBe(true);
    expect(sets.every((set) => set.restS === 180)).toBe(true);
  });

  it('a vest row keeps the added load in words, not as a percent', () => {
    const stepUp = makeExercise({
      id: 'vest_step_up',
      name: 'Weighted step-up',
      loadType: 'bodyweight',
      loadable: false,
      requiresBarbell: false,
      equipment: ['vest', 'box'],
      unilateral: true,
      isAxialLoad: false,
      isMainLift: false,
      roleCandidates: ['accessory'],
    });
    const sets = getPerSetPrescription(stepUp, makeAthlete('advanced'), makeContext({ sets: 2 }));
    expect(displays(sets)).toEqual(['8 × BW + 20 lb vest', '8 × BW + 20 lb vest']);
  });
});

describe('the Power block, deload, taper and peak shapes', () => {
  it('Power block main lift runs 3 sets of the same scheme (R109)', () => {
    const sets = getPerSetPrescription(
      backSquat,
      makeAthlete('intermediate'),
      makeContext({ blockType: 'power', sets: 3, workingMax: makeWorkingMax('back_squat', 275) }),
    );
    expect(displays(sets)).toEqual(['5 × 205 lb', '4 × 220 lb', '3 × 235 lb']);
  });

  it('the secondary lift retagged strength speed runs 60, 65, 70 percent (R109)', () => {
    const sets = getPerSetPrescription(
      trapBar,
      makeAthlete('intermediate'),
      makeContext({
        blockType: 'power',
        sets: 3,
        loadTypeOverride: 'strength_speed',
        role: 'secondary',
        workingMax: makeWorkingMax('trap_bar_deadlift', 275),
      }),
    );
    expect(displays(sets)).toEqual(['5 × 165 lb', '4 × 180 lb', '3 × 195 lb']);
    expect(sets.map((set) => set.loadPercent)).toEqual([60, 65, 70]);
  });

  it('deload holds the loads and cuts the reps to 40 percent (R105)', () => {
    const sets = getPerSetPrescription(
      backSquat,
      makeAthlete('intermediate'),
      makeContext({ kind: 'deload', sets: 2, workingMax: makeWorkingMax('back_squat', 275) }),
    );
    expect(displays(sets)).toEqual(['3 × 220 lb', '3 × 235 lb']);
    const reps = sets.reduce((total, set) => total + (set.reps ?? 0), 0);
    expect(reps).toBe(6);
    expect(reps / 15).toBeCloseTo(0.4, 10);
    expect(sets.every((set) => set.restS === 150)).toBe(true);
  });

  it('the taper takes the same shape as the deload', () => {
    const sets = getPerSetPrescription(
      backSquat,
      makeAthlete('intermediate'),
      makeContext({ kind: 'taper', sets: 2, workingMax: makeWorkingMax('back_squat', 275) }),
    );
    expect(displays(sets)).toEqual(['3 × 220 lb', '3 × 235 lb']);
  });

  it('the peak session sharpens: 2 sets from the bottom of the ladder', () => {
    const sets = getPerSetPrescription(
      backSquat,
      makeAthlete('intermediate'),
      makeContext({ kind: 'peak', sets: 2, workingMax: makeWorkingMax('back_squat', 275) }),
    );
    expect(displays(sets)).toEqual(['3 × 205 lb', '2 × 220 lb']);
  });
});
