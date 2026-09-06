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
 * The clearance block is deliberately absent too: the self-screen is medical
 * and the owner answers it personally, every time, so the prefill never writes
 * `isAdult` or `clearance`. With the prefill present and no clearance on file
 * the gate lands on `/setup/gate`; once the owner answers there, step 1 and
 * step 2 open prefilled exactly as before.
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
import { clockWindowFrom } from './clockWindow';
import { workingMaxesFrom } from './enteredMaxes';
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
  // Mornings, ten hours clear of the evening wall, so the week's hard pulling
  // day can sit on a climbing day (`house.sc.sport_requirements`). Without a
  // window the engine assumes an evening one, and that assumption refuses
  // every four-day pick a Sun, Tue, Thu climber can make.
  gymStart: '08:00',
  gymEnd: '10:00',
  inventory: OWNER_INVENTORY,
  boxSquatLb: '320',
  bestSets: {
    boxSquatLb: { reps: '2', loadLb: '305', rpe: 8.5, date: OWNER_BOX_SQUAT_SET_DATE },
  },
  readinessConfig: readinessConfigDefaults(),
};

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
    sessionWindow: clockWindowFrom(OWNER_STEP_TWO.gymStart, OWNER_STEP_TWO.gymEnd) as unknown as Json,
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
