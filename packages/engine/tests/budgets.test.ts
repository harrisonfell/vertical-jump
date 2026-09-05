/**
 * The counting conventions behind the two plyometric budgets (brief section 09
 * "Plyometrics: two budgets", decided where the rule book is silent): every
 * landing counts, so a depth jump is 2 contacts per rep and is both
 * high-intensity and high-amplitude; test attempts are high-intensity but not
 * high-amplitude; each change-of-direction cut is one extensive contact; the
 * warm-up carries none; primer pogos count as extensive.
 */
import { describe, expect, it } from 'vitest';

import {
  DEPTH_JUMP_REPS_MAX,
  HIGH_AMPLITUDE_MAX,
  HIGH_INTENSITY_MAX,
  computeExtensiveTarget,
  countContacts,
  depthJumpRepBudget,
  withinHardCaps,
} from '../src/budgets.js';
import type { Exercise } from '../src/types/exercise.js';
import type { ExerciseId, SessionBlockName } from '../src/types/core.js';
import type { SessionBlock, SetPrescription } from '../src/types/plan.js';

function exercise(id: ExerciseId, overrides: Partial<Exercise>): Exercise {
  return {
    id,
    name: id,
    loadType: 'bodyweight',
    loadable: false,
    displayMode: 'reps',
    stabilityDemand: 'moderate',
    kneeStress: 'moderate',
    spineStress: 'low',
    shoulderStress: 'low',
    cnsCost: 'moderate',
    fatigueCost: 'moderate',
    equipment: [],
    requiresBarbell: false,
    movementPattern: 'jump',
    plane: 'sagittal',
    unilateral: false,
    isAxialLoad: false,
    isOverhead: false,
    isPressing: false,
    isPush: false,
    isPull: false,
    isPulling: false,
    isRnt: false,
    repetitiveImpact: true,
    isOlympicLift: false,
    technicalSkillHigh: false,
    intent: 'elastic',
    levelMin: 'beginner',
    roleCandidates: ['power_jump'],
    isMainLift: false,
    defaultSets: 3,
    prefersLoadableInStrengthBlock: false,
    readinessRequired: false,
    cues: [],
    dayTypes: ['power_speed'],
    categoryForCharts: 'plyometrics',
    ...overrides,
  };
}

function sets(count: number, reps: number): SetPrescription[] {
  return Array.from({ length: count }, (_unused, index) => ({
    setNumber: index + 1,
    reps,
    displayLoad: `${reps}`,
    restS: 180,
    restRule: 'maximal jumps',
    isRamp: false,
    isHeld: false,
  }));
}

function block(name: SessionBlockName, rows: { id: ExerciseId; sets: SetPrescription[] }[]): SessionBlock {
  return {
    name,
    grouped: name === 'warm_up' || name === 'cool_down',
    exercises: rows.map((row) => ({
      exerciseId: row.id,
      name: row.id,
      block: name,
      role: 'power_jump' as const,
      loadType: 'bodyweight' as const,
      loadMode: 'none' as const,
      bothSides: false,
      sets: row.sets,
      restS: 180,
      restRule: 'maximal jumps',
      sourceLine: '',
      landingPromptOnLastSet: false,
      contactsPerRep: 1,
      cues: [],
    })),
  };
}

const DEPTH_JUMP = exercise('depth_jump_18', {
  plyometric: {
    contactTime: 'fast',
    amplitude: 'high',
    intensity: 'high',
    category: 'intensive',
    contactsPerRep: 2,
    isMaximalJump: true,
    heightIn: 18,
  },
  kneeStress: 'high',
  cnsCost: 'high',
});

const TEST_ATTEMPT = exercise('cmj_test', {
  plyometric: {
    contactTime: 'slow',
    amplitude: 'low',
    intensity: 'high',
    category: 'intensive',
    contactsPerRep: 1,
    isMaximalJump: true,
  },
  cnsCost: 'high',
});

const POGO = exercise('pogo', {
  plyometric: {
    contactTime: 'fast',
    amplitude: 'low',
    intensity: 'low',
    category: 'extensive',
    contactsPerRep: 1,
    isMaximalJump: false,
  },
});

const SHUTTLE = exercise('shuttle_5_10_5', {
  movementPattern: 'cod',
  codCutsPerRep: 2,
  displayMode: 'distance',
});

const HIP_OPENER = exercise('hip_opener', {
  movementPattern: 'mobility',
  loadType: 'mobility',
  intent: 'mobility',
  plyometric: {
    contactTime: 'slow',
    amplitude: 'low',
    intensity: 'low',
    category: 'extensive',
    contactsPerRep: 1,
    isMaximalJump: false,
  },
});

const BY_ID = new Map<ExerciseId, Exercise>([
  [DEPTH_JUMP.id, DEPTH_JUMP],
  [TEST_ATTEMPT.id, TEST_ATTEMPT],
  [POGO.id, POGO],
  [SHUTTLE.id, SHUTTLE],
  [HIP_OPENER.id, HIP_OPENER],
]);

describe('countContacts conventions', () => {
  it('counts a depth jump as 2 contacts a rep, high-intensity and high-amplitude', () => {
    const contacts = countContacts(
      [block('power', [{ id: DEPTH_JUMP.id, sets: sets(4, 2) }])],
      BY_ID,
      60,
    );
    expect(contacts.highIntensity).toBe(16);
    expect(contacts.highAmplitude).toBe(16);
    expect(contacts.extensive).toBe(0);
  });

  it('counts test attempts as high-intensity but not high-amplitude', () => {
    const contacts = countContacts(
      [block('jump_test', [{ id: TEST_ATTEMPT.id, sets: sets(5, 1) }])],
      BY_ID,
      60,
    );
    expect(contacts.highIntensity).toBe(5);
    expect(contacts.highAmplitude).toBe(0);
  });

  it('counts primer pogos as extensive and each COD cut as one extensive contact', () => {
    const contacts = countContacts(
      [
        block('primer', [{ id: POGO.id, sets: sets(2, 5) }]),
        block('cod', [{ id: SHUTTLE.id, sets: sets(1, 4) }]),
      ],
      BY_ID,
      60,
    );
    expect(contacts.extensive).toBe(18);
  });

  it('counts nothing in the warm-up or the cool-down', () => {
    const contacts = countContacts(
      [
        block('warm_up', [{ id: HIP_OPENER.id, sets: sets(2, 8) }]),
        block('cool_down', [{ id: HIP_OPENER.id, sets: sets(2, 8) }]),
      ],
      BY_ID,
      60,
    );
    expect(contacts.extensive).toBe(0);
  });

  it('holds the hard caps and reports the worked Power day totals', () => {
    const contacts = countContacts(
      [
        block('primer', [{ id: POGO.id, sets: sets(2, 5) }]),
        block('jump_test', [{ id: TEST_ATTEMPT.id, sets: sets(5, 1) }]),
        block('power', [{ id: DEPTH_JUMP.id, sets: sets(4, 2) }]),
        block('cod', [{ id: SHUTTLE.id, sets: sets(1, 4) }]),
      ],
      BY_ID,
      60,
    );
    expect(contacts.highIntensity).toBe(21);
    expect(contacts.highAmplitude).toBe(16);
    expect(contacts.capHigh).toBe(HIGH_INTENSITY_MAX);
    expect(contacts.capAmplitude).toBe(HIGH_AMPLITUDE_MAX);
    expect(withinHardCaps(contacts)).toBe(true);
    expect(withinHardCaps({ ...contacts, highIntensity: 26 })).toBe(false);
  });

  it('keeps the depth-jump rep budget at 10 and the R89 formula exact', () => {
    expect(DEPTH_JUMP_REPS_MAX).toBe(10);
    expect(depthJumpRepBudget(5)).toBe(10);
    expect(computeExtensiveTarget(80, 120, 0, 17)).toBe(80);
    expect(computeExtensiveTarget(80, 120, 5, 5)).toBe(120);
    expect(computeExtensiveTarget(80, 120, 3, 5)).toBe(100);
  });
});
