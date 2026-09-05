/**
 * The climbing answers: what setup asks, what it refuses, and the athlete
 * patch it writes.
 *
 * Everything here is pure so the block, the Settings rows and the test read
 * the same rules. The five answers belong to four house rules
 * (`house.sc.open_hand_grip`, `house.sc.finger_pain_ceiling`,
 * `house.sc.rnt_valgus_control`, `house.sc.weaker_side_first`), and each one
 * has a default that reads as "never asked", so an athlete who never saw the
 * block keeps exactly the program they had.
 */
import { loadRuleset } from '@vert/engine';
import type { GripMode, Side, WallWork, Weekday } from '@vert/engine';
import type { Athlete, Json } from '@/data';
import {
  defaultFingerPainCeiling,
  defaultWallGapHours,
  readValgusControl,
  readWallWork,
} from '@/lib/engineAthlete';
import type { GripModeValue, SecondaryGoalValue, WeakerSideValue } from './questions';

/** 0 to 10, the same scale the soreness and pain questions use. */
export const CEILING_MIN = 0;
export const CEILING_MAX = 10;

/**
 * The same-day gap, in hours (`house.sc.hard_finger_spacing`). Zero is an
 * answer ("they never clash"), and past half a day the two windows cannot both
 * fit in one, so the stepper stops there.
 */
export const WALL_GAP_MIN = 0;
export const WALL_GAP_MAX = 12;

/** A 24-hour clock time, which is the only shape a wall-work time reads in. */
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface ClimbingAnswers {
  readonly secondaryGoal: SecondaryGoalValue | null;
  readonly fingerHistory: boolean;
  readonly gripMode: GripModeValue;
  readonly fingerPainCeiling: number;
  /** Weekday numbers, 0 Sunday to 6 Saturday. */
  readonly wallWorkDays: readonly number[];
  /** "18:00", kept exactly as typed so a refusal never clears the field. */
  readonly wallStart: string;
  readonly wallEnd: string;
  /** The owner's answer: a wall session IS a hard finger session. */
  readonly wallFingerHard: boolean;
  /** Hours gym finger work keeps from the wall on a shared day. */
  readonly wallGapHours: number;
  readonly valgusControl: boolean;
  readonly weakerSide: WeakerSideValue;
}

/**
 * What the block opens on. The ceiling comes from the ruleset rather than
 * from a number typed here, so changing the file changes the default once,
 * and the RNT toggle opens on for an athlete who is being asked at all.
 */
export function climbingDefaults(): ClimbingAnswers {
  return {
    secondaryGoal: null,
    fingerHistory: false,
    gripMode: 'any',
    fingerPainCeiling: defaultFingerPainCeiling(),
    wallWorkDays: [],
    wallStart: '',
    wallEnd: '',
    wallFingerHard: true,
    wallGapHours: defaultWallGapHours(),
    valgusControl: true,
    weakerSide: 'unsure',
  };
}

/**
 * The block is shown for a speed climber, and for anybody who reports a
 * finger or pulley history: the grip constraint follows the injury, not the
 * sport.
 */
export function showsGripBlock(sport: string | null, fingerHistory: boolean): boolean {
  return sport === 'speed_climbing' || fingerHistory;
}

/** The sport whose main lifts are the box squat and the weighted pull-up. */
export function showsClimbingLifts(sport: string | null): boolean {
  return sport === 'speed_climbing';
}

export type ClimbingField = 'wallStart' | 'wallEnd' | 'fingerPainCeiling' | 'wallGapHours';

export interface ClimbingResult {
  readonly errors: Readonly<Partial<Record<ClimbingField, string>>>;
  readonly ok: boolean;
}

/** Every refusal the climbing answers carry, in one pass. */
export function validateClimbing(values: ClimbingAnswers): ClimbingResult {
  const errors: Partial<Record<ClimbingField, string>> = {};

  const start = values.wallStart.trim();
  const end = values.wallEnd.trim();
  const shape = 'Use a 24-hour time, for example 18:00.';

  if (start !== '' && !CLOCK.test(start)) errors.wallStart = shape;
  if (end !== '' && !CLOCK.test(end)) errors.wallEnd = shape;
  if (errors.wallStart === undefined && errors.wallEnd === undefined) {
    if (start === '' && end !== '') errors.wallStart = 'Enter both times, or leave both blank.';
    if (end === '' && start !== '') errors.wallEnd = 'Enter both times, or leave both blank.';
    if (start !== '' && end !== '' && end <= start) {
      errors.wallEnd = 'The end time has to be after the start.';
    }
  }

  if (
    !Number.isFinite(values.fingerPainCeiling) ||
    values.fingerPainCeiling < CEILING_MIN ||
    values.fingerPainCeiling > CEILING_MAX
  ) {
    errors.fingerPainCeiling = `A pain ceiling reads between ${CEILING_MIN} and ${CEILING_MAX}.`;
  }

  if (
    !Number.isFinite(values.wallGapHours) ||
    values.wallGapHours < WALL_GAP_MIN ||
    values.wallGapHours > WALL_GAP_MAX
  ) {
    errors.wallGapHours = `A same-day gap reads between ${WALL_GAP_MIN} and ${WALL_GAP_MAX} hours.`;
  }

  return { errors, ok: Object.keys(errors).length === 0 };
}

/** The wall-work object the engine reads, or null when no day is marked. */
export function wallWorkFrom(values: ClimbingAnswers): WallWork | null {
  const weekdays = [...new Set(values.wallWorkDays)]
    .filter((day): day is Weekday => Number.isInteger(day) && day >= 0 && day <= 6)
    .sort((a, b) => a - b);
  if (weekdays.length === 0) return null;
  const start = values.wallStart.trim();
  const end = values.wallEnd.trim();
  // Both answers are always written once a wall day exists: the engine reads
  // an absent `fingerLoad` as hard and an absent gap as six hours, which are
  // the defaults, so writing them keeps the stored row and the screen honest
  // about what the athlete actually chose.
  const wallWork: WallWork = {
    weekdays,
    fingerLoad: values.wallFingerHard ? 'hard' : 'light',
    sameDayGapHours: values.wallGapHours,
  };
  if (CLOCK.test(start) && CLOCK.test(end)) {
    return { ...wallWork, typicalStart: start, typicalEnd: end };
  }
  return wallWork;
}

/** The columns migration 5 added, written from the answers as given. */
export interface ClimbingPatch {
  readonly secondaryGoal: string | null;
  readonly fingerHistory: boolean;
  readonly gripMode: GripMode;
  readonly fingerPainCeiling: number;
  readonly wallWork: Json;
  readonly valgusControl: Json;
  readonly weakerSide: Side | null;
}

/**
 * The athlete patch. A finger history forces open hand whatever the grip
 * answer says, which is the same narrowing the bridge does when the two
 * columns disagree (`house.sc.open_hand_grip`).
 *
 * `shown` is whether the block was on screen. An athlete who was never asked
 * gets the never-asked answers written rather than the block's own defaults,
 * so a basketball profile never picks up an injury-prevention row nobody
 * asked for.
 */
export function climbingPatchFrom(values: ClimbingAnswers, shown: boolean): ClimbingPatch {
  const climbing = loadRuleset().constants.climbing;
  const answers: ClimbingAnswers = shown
    ? values
    : { ...climbingDefaults(), secondaryGoal: values.secondaryGoal, valgusControl: false };
  return {
    secondaryGoal: answers.secondaryGoal,
    fingerHistory: answers.fingerHistory,
    gripMode: answers.fingerHistory ? 'open_hand' : answers.gripMode,
    fingerPainCeiling: answers.fingerPainCeiling,
    wallWork: wallWorkFrom(answers) as unknown as Json,
    valgusControl: {
      required: answers.valgusControl,
      sessionsPerWeek: climbing.rntSessionsPerWeek,
      minHoursFromWall: climbing.rntWallGapHours,
    } as unknown as Json,
    weakerSide: answers.weakerSide === 'unsure' ? null : answers.weakerSide,
  };
}

const SECONDARY_GOALS: readonly SecondaryGoalValue[] = [
  'upper_body_power',
  'speed',
  'strength',
  'injury_prevention',
];

/** The stored row read back as the answers the athlete gave. */
export function climbingAnswersFrom(athlete: Athlete | null | undefined): ClimbingAnswers {
  const defaults = climbingDefaults();
  if (athlete == null) return defaults;
  const wall = readWallWork(athlete.wallWork ?? null);
  const valgus = readValgusControl(athlete.valgusControl ?? null);
  const ceiling = athlete.fingerPainCeiling;
  const grip = athlete.gripMode;
  return {
    secondaryGoal:
      SECONDARY_GOALS.find((goal) => goal === athlete.secondaryGoal) ?? null,
    fingerHistory: athlete.fingerHistory === true,
    gripMode: grip === 'open_hand' ? 'open_hand' : grip == null ? defaults.gripMode : 'any',
    fingerPainCeiling:
      typeof ceiling === 'number' && Number.isFinite(ceiling)
        ? ceiling
        : defaults.fingerPainCeiling,
    wallWorkDays: wall?.weekdays ?? [],
    wallStart: wall?.typicalStart ?? '',
    wallEnd: wall?.typicalEnd ?? '',
    wallFingerHard: wall?.fingerLoad !== 'light',
    wallGapHours: wall?.sameDayGapHours ?? defaults.wallGapHours,
    valgusControl: athlete.valgusControl == null ? defaults.valgusControl : valgus.required,
    weakerSide: athlete.weakerSide ?? 'unsure',
  };
}
