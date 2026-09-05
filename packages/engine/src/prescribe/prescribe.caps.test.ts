/**
 * Block 6 caps, the ballistic override, the soreness tier-down and the load
 * grid. Expectations from brief section 09 "Load prescription" and "Worked
 * numbers", and from the rule book's R154, R155, R162 and R163.
 */
import { describe, expect, it } from 'vitest';
import type { PainGateResult } from '../types/pain.js';
import { getPerSetPrescription } from './index.js';
import { resolveCapPct } from './caps.js';
import {
  RULES,
  displays,
  makeAthlete,
  makeContext,
  makeExercise,
  makeInventory,
  makeWorkingMax,
} from './prescribe.fixtures.test.js';

const backSquat = makeExercise({ id: 'back_squat', name: 'Back squat' });

describe('the ballistic override', () => {
  const jumpSquat = makeExercise({
    id: 'loaded_jump_squat',
    name: 'Loaded jump squat',
    loadType: 'ballistic',
    movementPattern: 'jump',
    ballisticCapPct: 30,
    isMainLift: false,
    roleCandidates: ['power_jump'],
    intent: 'velocity',
    plyometric: {
      contactTime: 'slow',
      amplitude: 'high',
      intensity: 'high',
      category: 'intensive',
      contactsPerRep: 1,
      isMaximalJump: true,
    },
  });

  it('advanced: 3 x 3 at 30 percent of squat max, rounded down', () => {
    const sets = getPerSetPrescription(
      jumpSquat,
      makeAthlete('advanced'),
      makeContext({ sets: 3, squatWorkingMax: makeWorkingMax('back_squat', 275) }),
    );
    expect(displays(sets)).toEqual(['3 × 80 lb', '3 × 80 lb', '3 × 80 lb']);
    expect(sets.every((set) => set.loadPercent === 30)).toBe(true);
    expect(sets.every((set) => set.restS === 180)).toBe(true);
  });

  it('intermediate caps at 20 percent, beginner is bodyweight', () => {
    const intermediate = getPerSetPrescription(
      jumpSquat,
      makeAthlete('intermediate'),
      makeContext({ sets: 3, squatWorkingMax: makeWorkingMax('back_squat', 275) }),
    );
    expect(displays(intermediate)).toEqual(['3 × 55 lb', '3 × 55 lb', '3 × 55 lb']);
    const beginner = getPerSetPrescription(
      jumpSquat,
      makeAthlete('beginner'),
      makeContext({ sets: 3, squatWorkingMax: makeWorkingMax('back_squat', 275) }),
    );
    expect(displays(beginner)).toEqual(['3 × BW', '3 × BW', '3 × BW']);
  });
});

describe('the caps, lowest wins', () => {
  const emptyGate = (): PainGateResult => ({
    blocksGeneration: false,
    clearanceScreen: null,
    exclusions: {
      kneeHigh: false,
      spineHigh: false,
      shoulderHigh: false,
      allPlyo: false,
      highIntensityPlyo: false,
      highImpactPlyo: false,
      repetitiveImpact: false,
      overhead: false,
      pressing: false,
      axialHeavy: false,
      axialAll: false,
      allKneeStress: false,
      allSpineStress: false,
      excludedPatterns: [],
    },
    caps: { scopedTo: [] },
    volumeCuts: {},
    tendonProtocols: [],
    restricted: false,
    lines: [],
  });

  it('R163: a mild knee-pain cap of 80 percent binds knee-stress lifts only', () => {
    const athlete = makeAthlete('intermediate');
    const sets = getPerSetPrescription(
      backSquat,
      athlete,
      makeContext({
        sets: 4,
        painCaps: { intensityPct: 80, scopedTo: ['knee_stress'] },
        painCapReason: 'mild knee pain',
        workingMax: makeWorkingMax('back_squat', 275),
      }),
    );
    expect(sets.map((set) => set.loadPercent)).toEqual([75, 80, 80, 80]);
    expect(displays(sets)).toEqual(['5 × 205 lb', '4 × 220 lb', '3 × 220 lb', '3 × 220 lb']);

    const gate = emptyGate();
    gate.caps = { intensityPct: 80, scopedTo: ['knee_stress'] };
    const cap = resolveCapPct(
      backSquat,
      athlete,
      makeContext({ sets: 4, painCapReason: 'mild knee pain' }),
      gate,
    );
    expect(cap.capPct).toBe(80);
    expect(cap.note).toBe('Capped at 80%: mild knee pain');
  });

  it('R163: a pressing-scoped cap leaves a squat alone', () => {
    const sets = getPerSetPrescription(
      backSquat,
      makeAthlete('intermediate'),
      makeContext({
        sets: 4,
        painCaps: { intensityPct: 80, scopedTo: ['pressing'] },
        workingMax: makeWorkingMax('back_squat', 275),
      }),
    );
    expect(sets.map((set) => set.loadPercent)).toEqual([75, 80, 85, 85]);
  });

  it('R1: under 18 caps at 90 percent', () => {
    const athlete = makeAthlete('advanced', { isAdult: false });
    const cap = resolveCapPct(backSquat, athlete, makeContext({ sets: 4 }), emptyGate());
    expect(cap.capPct).toBe(RULES.constants.painCaps.under18CapPct);
    expect(cap.note).toBe('Capped at 90%: under 18');
  });

  it('the level cap is the default and says so', () => {
    const cap = resolveCapPct(
      backSquat,
      makeAthlete('advanced'),
      makeContext({ sets: 4 }),
      emptyGate(),
    );
    expect(cap.capPct).toBe(92);
    expect(cap.note).toBe('Held at the 92% cap');
  });

  it('week 1 of a first program holds the top set at 80 percent (R92 house)', () => {
    const sets = getPerSetPrescription(
      backSquat,
      makeAthlete('advanced'),
      makeContext({
        w: 1,
        sets: 4,
        isFirstProgramWeek1: true,
        workingMax: makeWorkingMax('back_squat', 275),
      }),
    );
    expect(sets.map((set) => set.loadPercent)).toEqual([75, 80, 80, 80]);
  });
});

describe('the soreness tier-down (R27)', () => {
  it('adds 2 reps, drops 10 percentage points, and keeps the original row', () => {
    const sets = getPerSetPrescription(
      backSquat,
      makeAthlete('intermediate'),
      makeContext({ sets: 4, sorenessToday: 8, workingMax: makeWorkingMax('back_squat', 275) }),
    );
    expect(displays(sets)).toEqual(['7 × 180 lb', '6 × 195 lb', '5 × 205 lb', '5 × 205 lb']);
    expect(sets.map((set) => set.loadPercent)).toEqual([65, 70, 75, 75]);
    expect(sets[0]?.original?.displayLoad).toBe('5 × 205 lb');
    expect(sets[3]?.original?.loadPercent).toBe(85);
    expect(sets[3]?.original?.original).toBeUndefined();
  });

  it('leaves a session below the threshold untouched', () => {
    const sets = getPerSetPrescription(
      backSquat,
      makeAthlete('intermediate'),
      makeContext({ sets: 4, sorenessToday: 6, workingMax: makeWorkingMax('back_squat', 275) }),
    );
    expect(displays(sets)).toEqual(['5 × 205 lb', '4 × 220 lb', '3 × 235 lb', '3 × 235 lb']);
    expect(sets.every((set) => set.original === undefined)).toBe(true);
  });

  it('a bodyweight row keeps its vest tail when the reps rise', () => {
    const stepUp = makeExercise({
      id: 'vest_step_up',
      loadType: 'bodyweight',
      loadable: false,
      requiresBarbell: false,
      equipment: ['vest'],
      isAxialLoad: false,
      isMainLift: false,
      roleCandidates: ['accessory'],
    });
    const sets = getPerSetPrescription(
      stepUp,
      makeAthlete('advanced'),
      makeContext({ sets: 1, sorenessToday: 9 }),
    );
    expect(displays(sets)).toEqual(['10 × BW + 20 lb vest']);
  });
});

describe('rounding falls back to what the athlete can load (R162)', () => {
  it('a coarser plate pair becomes the grid', () => {
    const athlete = makeAthlete('intermediate', {
      inventory: makeInventory({ plates: { smallestPairLb: 10 } }),
    });
    const sets = getPerSetPrescription(
      backSquat,
      athlete,
      makeContext({ sets: 3, workingMax: makeWorkingMax('back_squat', 275) }),
    );
    expect(displays(sets)).toEqual(['5 × 210 lb', '4 × 220 lb', '3 × 230 lb']);
  });
});
