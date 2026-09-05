/**
 * Fixtures the skeleton, adherence and move tests share. Not a test file:
 * vitest only collects `*.test.ts`.
 */
import type { Athlete, Inventory } from '../src/types/athlete.js';
import type { DayType, DaysPerWeek, TrainingAge, WeekKind } from '../src/types/core.js';
import type { LocalDate, Weekday } from '../src/types/calendar.js';
import type { SessionPlan, SkeletonTargets, WeekPlan } from '../src/types/plan.js';
import { weekdayOf } from '../src/calendar.js';
import { deriveLevel } from '../src/level.js';

/** Mon, Tue, Thu, Sat: the owner's picks. */
export const OWNER_WEEKDAYS: Weekday[] = [1, 2, 4, 6];

/** A Monday, so `programStart` is the same day and W lands on 12. */
export const MONDAY = '2026-09-07';
export const TARGET = '2026-11-29';

export function buildInventory(overrides: Partial<Inventory> = {}): Inventory {
  return {
    barbell: true,
    rack: true,
    plates: { smallestPairLb: 2.5 },
    trapBar: true,
    dumbbells: { maxLb: 100, incrementLb: 5 },
    kettlebells: false,
    boxHeightsIn: [12, 18, 24],
    hurdleHeightsIn: [6, 9, 12],
    bands: true,
    medBall: true,
    bench: true,
    pullupBar: true,
    cable: false,
    sled: false,
    weightRoomAccess: true,
    ...overrides,
  };
}

export function buildAthlete(overrides: Partial<Athlete> = {}): Athlete {
  const trainingAge: TrainingAge = overrides.trainingAge ?? '4plus';
  return {
    id: 'owner',
    primaryGoal: 'vertical_jump',
    sport: 'basketball',
    trainingAge,
    level: overrides.level ?? deriveLevel(trainingAge),
    daysPerWeek: 4,
    weekdays: OWNER_WEEKDAYS,
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
      attestedAt: MONDAY,
    },
    painStatus: [],
    inventory: buildInventory(),
    bodyweightKg: 84,
    workingMaxes: [],
    inSeason: false,
    readinessPassedAt: MONDAY,
    standingReachMm: null,
    goalHeightMm: 914,
    targetDate: TARGET,
    primaryInstrument: 'ovr_jump_regular',
    baselineHeightMm: 747,
    timezone: 'America/New_York',
    rolloverHour: 3,
    canonicalTestNote: 'CMJ with arm swing, OVR Jump Regular mode.',
    sorenessHistory: [],
    extraEquipment: [],
    ...overrides,
  };
}

export function buildTargets(overrides: Partial<SkeletonTargets> = {}): SkeletonTargets {
  return {
    extensiveBottom: 80,
    extensiveTop: 120,
    highIntensityAllowance: 21,
    depthJumpReps: 8,
    startOffsetPct: {},
    mainLiftBySlot: { lower: 'back_squat', upper: 'db_bench_press', fullbody: 'back_squat' },
    accessoryRotationSlot: 0,
    ladderRungs: {},
    tendonMode: 'plyometric',
    ...overrides,
  };
}

/** One session with no exercises: enough for adherence and move decisions. */
export function buildSession(
  id: string,
  date: LocalDate,
  dayType: DayType,
  options: { isMaximalCns?: boolean; isTestDay?: boolean } = {},
): SessionPlan {
  return {
    id,
    date,
    weekday: weekdayOf(date),
    dayType,
    isTestDay: options.isTestDay ?? false,
    isMaximalCns: options.isMaximalCns ?? false,
    fingerLoad: 'none',
    rntScheduled: false,
    estimatedMinutes: 70,
    headerSuffixes: [],
    notices: [],
    blocks: [],
    contacts: {
      extensive: 0,
      highIntensity: 0,
      highAmplitude: 0,
      targetExtensive: 0,
      capHigh: 25,
      capAmplitude: 20,
    },
    trimmed: [],
  };
}

export function buildWeekPlan(
  sessions: SessionPlan[],
  options: { w?: number; windowStart?: LocalDate; windowEnd?: LocalDate; kind?: WeekKind } = {},
): WeekPlan {
  return {
    w: options.w ?? 7,
    kind: options.kind ?? 'load',
    blockType: 'power',
    windowStart: options.windowStart ?? '2026-10-19',
    windowEnd: options.windowEnd ?? '2026-10-25',
    sessions,
    snapshot: {
      adherenceUsed: 1,
      outcome: 'progress',
      workingMaxes: [],
      k: 0,
      targets: buildTargets(),
      seed: 1,
      rulesetVersion: '1.0.0',
      generatedAt: '2026-10-19T03:00:00.000Z',
    },
    lines: [],
  };
}

/** The owner's week: Mon Lower Strength, Tue Upper, Thu Power + Speed, Sat Recovery. */
export function buildOwnerWeek(): WeekPlan {
  return buildWeekPlan([
    buildSession('s1', '2026-10-19', 'lower_strength', { isMaximalCns: true }),
    buildSession('s2', '2026-10-20', 'upper_strength'),
    buildSession('s3', '2026-10-22', 'power_speed', { isMaximalCns: true, isTestDay: true }),
    buildSession('s4', '2026-10-24', 'recovery_mobility'),
  ]);
}

export const DAYS_PER_WEEK: DaysPerWeek[] = [2, 3, 4, 5];
