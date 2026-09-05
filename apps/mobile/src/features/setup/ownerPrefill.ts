/**
 * The owner's saved profile: the answers, once, in one place.
 *
 * The owner has given these answers already and does not want to type them
 * again on a fresh install. Two paths reach them and both end in the same
 * values: `EXPO_PUBLIC_OWNER=1` writes the athlete row at boot (and nothing
 * else: no program, no logs, no tests, no Whoop rows), and Settings > "Use my
 * saved profile" fills the setup forms without writing anything until the
 * owner saves.
 *
 * Two answers are deliberately absent: the baseline jump height and the goal
 * height. Nobody but the athlete knows those, and a program built on a guessed
 * baseline is a program built on nothing, so setup still stops at step 2.
 *
 * The clearance block carries the owner's own PAR-Q+ answers, which is what
 * makes this a saved profile rather than half of one. It is attested on the
 * day the profile is applied, and answering the self-screen again from
 * Settings > Health replaces it.
 */
import { deriveLevel } from '@vert/engine';
import type { Inventory } from '@vert/engine';
import type { AthletePatch } from '@/data/store/athlete';
import type { Json, LocalDate } from '@/data/types';
import {
  TRAINING_AGE_YEARS,
  defaultFingerPainCeiling,
  defaultWallGapHours,
} from '@/lib/engineAthlete';
import { weightRoomAccess } from '@/lib/inventory';
import { bestSetsFrom } from './bestSets';
import { climbingPatchFrom, type ClimbingAnswers } from './climbing';
import { workingMaxesFrom } from './enteredMaxes';
import { RED_FLAG_KEYS } from './questions';
import { readinessConfigDefaults, toReadinessTestConfig } from './readinessConfig';
import type { StepOneValues } from './stepOne';
import { stepTwoDefaults, type StepTwoValues } from './stepTwoValues';

/** The owner's gym: a rack, a box, dumbbells to 100 lb, bands, a hangboard. */
export const OWNER_INVENTORY: Inventory = {
  barbell: true,
  rack: true,
  plates: { smallestPairLb: 5 },
  trapBar: false,
  dumbbells: { maxLb: 100, incrementLb: 5 },
  kettlebells: false,
  boxHeightsIn: [12, 18, 24, 30],
  hurdleHeightsIn: [],
  bands: true,
  medBall: true,
  bench: true,
  pullupBar: true,
  cable: false,
  sled: false,
  hangboard: true,
  boxSquatBox: true,
  climbingWall: true,
  weightRoomAccess: true,
};

/** Wall work: Sunday, Tuesday and Thursday, 18:00 to 20:00, hard on the fingers. */
const OWNER_CLIMBING: ClimbingAnswers = {
  secondaryGoal: 'speed',
  fingerHistory: true,
  gripMode: 'open_hand',
  fingerPainCeiling: defaultFingerPainCeiling(),
  wallWorkDays: [0, 2, 4],
  wallStart: '18:00',
  wallEnd: '20:00',
  wallFingerHard: true,
  wallGapHours: defaultWallGapHours(),
  valgusControl: true,
  weakerSide: 'unsure',
};

/** Step 1, as the owner answers it. */
export const OWNER_STEP_ONE: StepOneValues = {
  ...OWNER_CLIMBING,
  sport: 'speed_climbing',
  trainingAge: '4plus',
  daysPerWeek: 4,
  hasPain: false,
  painLocation: null,
  painSeverity: null,
  painDuration: null,
};

/** The date of the box squat the owner counts as their near-max (R73). */
export const OWNER_BOX_SQUAT_SET_DATE = '2026-08-31';

/**
 * Step 2, as far as the owner can answer it.
 *
 * `baselineIn`, `goalIn`, `targetDate` and `bodyweightLb` stay blank on
 * purpose: the first three are the owner's to measure and decide, and the
 * fourth changes week to week.
 */
export const OWNER_STEP_TWO: StepTwoValues = {
  ...stepTwoDefaults(),
  weekdays: [1, 2, 3, 5],
  daysPerWeek: 4,
  inventory: OWNER_INVENTORY,
  boxSquatLb: '320',
  bestSets: {
    boxSquatLb: { reps: '2', loadLb: '305', rpe: 8.5, date: OWNER_BOX_SQUAT_SET_DATE },
  },
  readinessConfig: readinessConfigDefaults(),
};

/** The self-screen the owner has already answered, attested on the day it lands. */
export function ownerClearance(today: LocalDate): Json {
  const answers: Record<string, unknown> = { attestedAt: today, isAdult: true };
  for (const key of RED_FLAG_KEYS) answers[key] = false;
  return answers as Json;
}

/**
 * The athlete row the two answer sets add up to.
 *
 * Everything here goes through the same pure writers setup uses, so a rule
 * that changes how a best set or an inventory is stored changes this too:
 * `climbingPatchFrom` for the wall and the fingers, `workingMaxesFrom` for the
 * entered box squat, `bestSetsFrom` for R73's own source.
 */
export function ownerAthletePatch(today: LocalDate, timezone: string, at: string): AthletePatch {
  return {
    primaryGoal: 'vertical_jump',
    sport: OWNER_STEP_ONE.sport,
    trainingAgeYears: TRAINING_AGE_YEARS[OWNER_STEP_ONE.trainingAge],
    level: deriveLevel(OWNER_STEP_ONE.trainingAge),
    daysPerWeek: OWNER_STEP_ONE.daysPerWeek,
    weekdays: [...OWNER_STEP_TWO.weekdays],
    isAdult: true,
    clearance: ownerClearance(today),
    inventory: OWNER_INVENTORY as unknown as Json,
    weightRoomAccess: weightRoomAccess(OWNER_INVENTORY),
    bodyweightKg: null,
    // The two the owner types in step 2. Absent is what keeps setup open.
    goalHeightMm: null,
    targetDate: null,
    standingReachMm: null,
    timezone,
    inSeason: false,
    workingMax: workingMaxesFrom(OWNER_STEP_TWO, at),
    bestSets: bestSetsFrom(OWNER_STEP_TWO.bestSets, today) as unknown as Json,
    readinessConfig: toReadinessTestConfig(OWNER_STEP_TWO.readinessConfig) as unknown as Json,
    ...climbingPatchFrom(OWNER_STEP_ONE, true),
  };
}
