/**
 * Fixtures shared by the Block 6 tests. Kept in a test file because this agent
 * owns only `src/prescribe/**` and `*.test.ts` beside it.
 */
import { describe, expect, it } from 'vitest';
import type { Athlete, Inventory, WorkingMax } from '../types/athlete.js';
import type { Exercise } from '../types/exercise.js';
import type { SetLog } from '../types/logs.js';
import type { SkeletonTargets } from '../types/plan.js';
import type { Level } from '../types/core.js';
import { RULESET_V1 } from '../ruleset/index.js';
import { lbToKg } from '../units.js';
import type { PrescribeContext } from './context.js';

export const RULES = RULESET_V1;

export function makeExercise(patch: Partial<Exercise> & Pick<Exercise, 'id'>): Exercise {
  return {
    name: patch.id,
    loadType: 'heavy_strength',
    loadable: true,
    displayMode: 'reps',
    stabilityDemand: 'moderate',
    kneeStress: 'moderate',
    spineStress: 'moderate',
    shoulderStress: 'low',
    cnsCost: 'high',
    fatigueCost: 'high',
    equipment: ['barbell', 'rack'],
    requiresBarbell: true,
    movementPattern: 'squat',
    plane: 'sagittal',
    unilateral: false,
    isAxialLoad: true,
    isOverhead: false,
    isPressing: false,
    isPush: false,
    isPull: false,
    isPulling: false,
    isRnt: false,
    repetitiveImpact: false,
    isOlympicLift: false,
    technicalSkillHigh: false,
    intent: 'strength',
    levelMin: 'beginner',
    roleCandidates: ['main_lift'],
    isMainLift: true,
    defaultSets: 4,
    prefersLoadableInStrengthBlock: true,
    readinessRequired: false,
    cues: [],
    dayTypes: ['lower_strength'],
    categoryForCharts: 'strength',
    ...patch,
  };
}

export function makeInventory(patch: Partial<Inventory> = {}): Inventory {
  return {
    barbell: true,
    rack: true,
    plates: { smallestPairLb: 5 },
    trapBar: true,
    dumbbells: { maxLb: 100, incrementLb: 5 },
    kettlebells: true,
    boxHeightsIn: [12, 18, 24],
    hurdleHeightsIn: [6, 9, 12],
    bands: true,
    medBall: true,
    vestLb: 20,
    bench: true,
    pullupBar: true,
    cable: false,
    sled: false,
    weightRoomAccess: true,
    ...patch,
  };
}

export function makeAthlete(level: Level, patch: Partial<Athlete> = {}): Athlete {
  return {
    id: 'owner',
    primaryGoal: 'vertical_jump',
    sport: 'basketball',
    trainingAge: level === 'advanced' ? '4plus' : level === 'intermediate' ? '1to3' : 'lt1',
    level,
    daysPerWeek: 4,
    weekdays: [1, 2, 4, 6],
    isAdult: true,
    clearance: {
      heartCondition: false,
      chestPain: false,
      dizziness: false,
      chronicCondition: false,
      prescriptionMedication: false,
      boneOrJointProblem: false,
      supervisedActivityOnly: false,
      isAdult: true,
    },
    painStatus: [],
    inventory: makeInventory(),
    bodyweightKg: lbToKg(190),
    workingMaxes: [],
    inSeason: false,
    standingReachMm: null,
    goalHeightMm: 914,
    targetDate: '2026-11-29',
    primaryInstrument: 'ovr_jump_regular',
    baselineHeightMm: 747,
    timezone: 'America/New_York',
    rolloverHour: 3,
    canonicalTestNote: 'standing countermovement, arm swing',
    sorenessHistory: [],
    extraEquipment: [],
    ...patch,
  };
}

export function makeTargets(patch: Partial<SkeletonTargets> = {}): SkeletonTargets {
  return {
    extensiveBottom: 80,
    extensiveTop: 120,
    highIntensityAllowance: 21,
    depthJumpReps: 8,
    startOffsetPct: {},
    mainLiftBySlot: { lower: 'back_squat', upper: 'bench_press', fullbody: 'back_squat' },
    accessoryRotationSlot: 0,
    ladderRungs: {},
    tendonMode: 'plyometric',
    ...patch,
  };
}

export function makeWorkingMax(lift: string, lb: number, patch: Partial<WorkingMax> = {}): WorkingMax {
  return {
    lift,
    valueKg: lbToKg(lb),
    source: 'entered',
    confidence: 1,
    frozenAt: '2026-09-08T03:00:00.000Z',
    failStreak: 0,
    ...patch,
  };
}

export function makeContext(patch: Partial<PrescribeContext> = {}): PrescribeContext {
  return {
    w: 2,
    kind: 'load',
    blockType: 'strength',
    k: 1,
    targets: makeTargets(),
    isFirstProgramWeek1: false,
    isFirstPercentWeekForLift: false,
    sets: 4,
    ruleset: RULES,
    ...patch,
  };
}

export function makeLog(patch: Partial<SetLog> & Pick<SetLog, 'id' | 'exerciseId'>): SetLog {
  return {
    sessionId: 'session-1',
    setNumber: 1,
    loadSource: 'rpe',
    completedAt: '2026-09-03T18:00:00.000Z',
    plannedDate: '2026-09-03',
    idempotencyKey: patch.id,
    ...patch,
  };
}

/** The display strings a prescription produced, in order. */
export function displays(sets: { displayLoad: string }[]): string[] {
  return sets.map((set) => set.displayLoad);
}

describe('fixtures', () => {
  it('load the validated ruleset', () => {
    expect(RULES.version).toBe('1.0.0');
    expect(RULES.constants.levelTopSetCapPct.intermediate).toBe(87);
  });
});
