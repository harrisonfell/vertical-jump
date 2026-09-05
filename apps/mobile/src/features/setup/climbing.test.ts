import { describe, expect, it } from 'vitest';
import { loadRuleset } from '@vert/engine';
import { toEngineAthlete } from '@/lib/engineAthlete';
import type { Athlete } from '@/data';
import {
  climbingAnswersFrom,
  climbingDefaults,
  climbingPatchFrom,
  showsClimbingLifts,
  showsGripBlock,
  validateClimbing,
  wallWorkFrom,
  type ClimbingAnswers,
} from './climbing';
import { readinessConfigDefaults, toReadinessTestConfig } from './readinessConfig';
import { maxRowsFor } from './maxLifts';
import { MAX_LIFT_IDS, PULL_UP_ENTRY_REPS, workingMaxesFrom } from './enteredMaxes';
import { STEP_TWO_DEFAULTS, type StepTwoValues } from './stepTwoValues';

/** The owner's own answers, as the block hands them back. */
const CLIMBER: ClimbingAnswers = {
  ...climbingDefaults(),
  secondaryGoal: 'upper_body_power',
  fingerHistory: true,
  gripMode: 'open_hand',
  fingerPainCeiling: 3,
  wallWorkDays: [3, 5],
  wallStart: '18:00',
  wallEnd: '20:00',
  valgusControl: true,
  weakerSide: 'left',
};

/** An athlete row carrying nothing but what the patch just wrote. */
function rowWith(patch: Partial<Athlete>): Athlete {
  return {
    id: 'athlete',
    primaryGoal: 'vertical_jump',
    sport: 'speed_climbing',
    trainingAgeYears: 5,
    level: 'advanced',
    daysPerWeek: 4,
    weekdays: [1, 2, 4, 6],
    isAdult: true,
    clearance: null,
    inventory: null,
    weightRoomAccess: true,
    bodyweightKg: 68,
    workingMax: {},
    inSeason: false,
    readinessPassedAt: null,
    standingReachMm: null,
    goalHeightMm: 914.4,
    targetDate: '2026-11-29',
    timezone: 'UTC',
    rolloverHour: 3,
    testConditionsNote: null,
    createdAt: '2026-09-05T00:00:00.000Z',
    updatedAt: '2026-09-05T00:00:00.000Z',
    ...patch,
  };
}

describe('the sport-conditional block', () => {
  it('opens for a speed climber, whatever they answered about their fingers', () => {
    expect(showsGripBlock('speed_climbing', false)).toBe(true);
    expect(showsGripBlock('speed_climbing', true)).toBe(true);
  });

  it('opens for a finger history on any sport, because the grip follows the injury', () => {
    expect(showsGripBlock('basketball', true)).toBe(true);
    expect(showsGripBlock('track_field', true)).toBe(true);
  });

  it('stays shut for a basketball athlete with no finger history', () => {
    expect(showsGripBlock('basketball', false)).toBe(false);
    expect(showsGripBlock('none', false)).toBe(false);
  });

  it('asks a speed climber for the box squat and the pull-up, and nobody else', () => {
    expect(showsClimbingLifts('speed_climbing')).toBe(true);
    expect(showsClimbingLifts('basketball')).toBe(false);
    expect(maxRowsFor('speed_climbing').map((row) => row.field)).toEqual([
      'boxSquatLb',
      'pullUpAddedLb',
    ]);
    expect(maxRowsFor('basketball').map((row) => row.field)).toEqual([
      'squatLb',
      'hingeLb',
      'pressLb',
    ]);
  });
});

describe('the climbing answers refuse', () => {
  it('accepts the owner answers', () => {
    expect(validateClimbing(CLIMBER)).toEqual({ errors: {}, ok: true });
  });

  it('refuses a time that is not a 24-hour clock time', () => {
    const result = validateClimbing({ ...CLIMBER, wallStart: '6pm' });
    expect(result.errors.wallStart).toBe('Use a 24-hour time, for example 18:00.');
    expect(result.ok).toBe(false);
    expect(validateClimbing({ ...CLIMBER, wallEnd: '24:00' }).errors.wallEnd).toBe(
      'Use a 24-hour time, for example 18:00.',
    );
  });

  it('refuses an end that is not after the start', () => {
    expect(validateClimbing({ ...CLIMBER, wallEnd: '18:00' }).errors.wallEnd).toBe(
      'The end time has to be after the start.',
    );
    expect(validateClimbing({ ...CLIMBER, wallEnd: '17:00' }).errors.wallEnd).toBe(
      'The end time has to be after the start.',
    );
  });

  it('asks for both times or neither', () => {
    expect(validateClimbing({ ...CLIMBER, wallEnd: '' }).errors.wallEnd).toBe(
      'Enter both times, or leave both blank.',
    );
    expect(validateClimbing({ ...CLIMBER, wallStart: '', wallEnd: '' }).ok).toBe(true);
  });

  it('keeps the pain ceiling on the 0 to 10 scale', () => {
    expect(validateClimbing({ ...CLIMBER, fingerPainCeiling: 11 }).errors.fingerPainCeiling).toBe(
      'A pain ceiling reads between 0 and 10.',
    );
    expect(validateClimbing({ ...CLIMBER, fingerPainCeiling: 0 }).ok).toBe(true);
  });

  it('drops the window when no wall day is marked', () => {
    expect(wallWorkFrom({ ...CLIMBER, wallWorkDays: [] })).toBeNull();
    // The two answers ride even without a window: the engine reads an absent
    // `fingerLoad` as hard and an absent gap as six hours, and the athlete
    // gave both answers whether or not they gave a time.
    expect(wallWorkFrom({ ...CLIMBER, wallStart: '', wallEnd: '' })).toEqual({
      weekdays: [3, 5],
      fingerLoad: 'hard',
      sameDayGapHours: 6,
    });
    expect(wallWorkFrom({ ...CLIMBER, wallFingerHard: false })?.fingerLoad).toBe('light');
  });
});

describe('the bridge round trip', () => {
  it('carries every answer through the patch and out of the engine athlete', () => {
    const patch = climbingPatchFrom(CLIMBER, true);
    const athlete = toEngineAthlete({
      athlete: rowWith(patch),
      pains: [],
      baseline: null,
    });

    expect(athlete.secondaryGoal).toBe('upper_body_power');
    expect(athlete.fingerHistory).toBe(true);
    expect(athlete.gripMode).toBe('open_hand');
    expect(athlete.fingerPainCeiling).toBe(3);
    expect(athlete.wallWork).toEqual({
      weekdays: [3, 5],
      typicalStart: '18:00',
      typicalEnd: '20:00',
      fingerLoad: 'hard',
      sameDayGapHours: loadRuleset().constants.climbing.rntWallGapHours,
    });
    expect(athlete.valgusControl).toEqual({
      required: true,
      sessionsPerWeek: loadRuleset().constants.climbing.rntSessionsPerWeek,
      minHoursFromWall: loadRuleset().constants.climbing.rntWallGapHours,
    });
    expect(athlete.weakerSide).toBe('left');
  });

  it('reads the stored row back as the answers that were given', () => {
    const patch = climbingPatchFrom(CLIMBER, true);
    expect(climbingAnswersFrom(rowWith(patch))).toEqual(CLIMBER);
  });

  it('forces open hand when a finger history is reported with any grip answer', () => {
    const patch = climbingPatchFrom({ ...CLIMBER, gripMode: 'any' }, true);
    expect(patch.gripMode).toBe('open_hand');
  });

  it('writes never-asked answers when the block was never on screen', () => {
    const patch = climbingPatchFrom({ ...CLIMBER, fingerHistory: false }, false);
    expect(patch.gripMode).toBe('any');
    expect(patch.wallWork).toBeNull();
    expect(patch.weakerSide).toBeNull();
    expect(patch.valgusControl).toMatchObject({ required: false });
    // The second goal is asked of everybody, so it survives a shut block.
    expect(patch.secondaryGoal).toBe('upper_body_power');

    const athlete = toEngineAthlete({ athlete: rowWith(patch), pains: [], baseline: null });
    expect(athlete.wallWork).toBeUndefined();
    expect(athlete.valgusControl).toMatchObject({ required: false });
  });

  it('reads an athlete who answered nothing as never asked', () => {
    const answers = climbingAnswersFrom(rowWith({}));
    expect(answers).toEqual(climbingDefaults());
  });
});

describe('the readiness configuration', () => {
  it('ships the gate defaults the ruleset carries', () => {
    const climbing = loadRuleset().constants.climbing.readiness;
    expect(readinessConfigDefaults()).toEqual({
      kind: 'seated_mb_throw',
      attempts: 3,
      baselineWindow: 7,
      lowThresholdPct: 5,
    });
    expect(toReadinessTestConfig(readinessConfigDefaults())).toEqual(climbing);
  });

  it('lets the metric follow the kind rather than asking for it', () => {
    expect(toReadinessTestConfig({ ...readinessConfigDefaults(), kind: 'cmj' }).metric).toBe(
      'height_in',
    );
    expect(toReadinessTestConfig({ ...readinessConfigDefaults(), kind: 'rsi' }).metric).toBe('rsi');
  });
});

describe('the entered maxes', () => {
  const values: StepTwoValues = {
    ...STEP_TWO_DEFAULTS,
    boxSquatLb: '320',
    pullUpAddedLb: '40',
  };
  const at = '2026-09-05T12:00:00.000Z';

  it('stores the box squat as an entered 1RM at its own lift id', () => {
    const maxes = workingMaxesFrom(values, at);
    const box = maxes[MAX_LIFT_IDS.boxSquat];
    expect(box?.source).toBe('entered');
    expect(box?.confidence).toBe(1);
    expect(box?.valueKg).toBeCloseTo(145.15, 1);
  });

  it('estimates the pull-up max from the added load, because it is a 5RM', () => {
    const maxes = workingMaxesFrom(values, at);
    const pullUp = maxes[MAX_LIFT_IDS.pullUp];
    expect(PULL_UP_ENTRY_REPS).toBe(5);
    expect(pullUp?.source).toBe('epley');
    expect(pullUp?.confidence).toBe(loadRuleset().constants.workingMax.epleyConfidence);
    // 40 lb x (1 + 5/30) x 0.95 is 44.3 lb, on the 5 lb grid.
    expect(pullUp?.valueKg).toBeGreaterThan(0);
  });

  it('writes nothing for a lift left blank', () => {
    expect(workingMaxesFrom(STEP_TWO_DEFAULTS, at)).toEqual({});
  });
});
