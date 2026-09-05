import { describe, expect, it } from 'vitest';
import { lbToKg } from '@vert/engine';
import type { Athlete } from '@/data';
import {
  defaultFingerPainCeiling,
  defaultReadinessConfig,
  defaultWallGapHours,
  readBestSets,
  readReadinessConfig,
  readValgusControl,
  readWallWork,
  toEngineAthlete,
} from './engineAthlete';
import { DEFAULT_INVENTORY, readInventory } from './inventory';

/**
 * The store-row to engine bridge, on the climbing columns.
 *
 * Every one of them has a default that reads as "never asked", so the test
 * that matters most is the one with an empty row: an athlete on the old
 * columns must come out of here with the program they already had.
 */

const CLEAR = {
  heartCondition: false,
  chestPain: false,
  dizziness: false,
  chronicCondition: false,
  prescriptionMedication: false,
  boneOrJointProblem: false,
  supervisedActivityOnly: false,
  isAdult: true,
  attestedAt: '2026-09-05',
};

function row(patch: Partial<Athlete> = {}): Athlete {
  return {
    id: 'athlete_owner',
    primaryGoal: 'vertical_jump',
    sport: 'speed_climbing',
    trainingAgeYears: 5,
    level: 'advanced',
    daysPerWeek: 4,
    weekdays: [1, 2, 4, 6],
    isAdult: true,
    clearance: CLEAR,
    inventory: {
      ...DEFAULT_INVENTORY,
      bands: true,
      medBall: true,
      hangboard: true,
      boxSquatBox: true,
      climbingWall: true,
    },
    weightRoomAccess: true,
    bodyweightKg: lbToKg(150),
    workingMax: {},
    inSeason: false,
    readinessPassedAt: '2026-09-01',
    standingReachMm: null,
    goalHeightMm: 914,
    targetDate: '2026-11-29',
    timezone: 'America/New_York',
    rolloverHour: 3,
    testConditionsNote: 'Shoes on, gym floor.',
    createdAt: '2026-09-05T12:00:00.000Z',
    updatedAt: '2026-09-05T12:00:00.000Z',
    ...patch,
  };
}

const BASELINE = { heightMm: 747, instrument: 'ovr_jump_regular' as const };

describe('the climbing answers, read into the engine athlete', () => {
  it('carries every column the owner answered', () => {
    const athlete = toEngineAthlete({
      athlete: row({
        secondaryGoal: 'upper_body_power',
        fingerHistory: true,
        gripMode: 'open_hand',
        fingerPainCeiling: 3,
        wallWork: { weekdays: [3, 5], typicalStart: '18:00', typicalEnd: '20:00' },
        sessionWindow: { start: '17:00', end: '19:00' },
        valgusControl: { required: true, sessionsPerWeek: 2, minHoursFromWall: 6 },
        weakerSide: 'left',
        readinessConfig: { kind: 'cmj', metric: 'height_in', attempts: 5 },
      }),
      pains: [],
      baseline: BASELINE,
    });

    expect(athlete.sport).toBe('speed_climbing');
    expect(athlete.secondaryGoal).toBe('upper_body_power');
    expect(athlete.fingerHistory).toBe(true);
    expect(athlete.gripMode).toBe('open_hand');
    expect(athlete.fingerPainCeiling).toBe(3);
    expect(athlete.wallWork).toEqual({
      weekdays: [3, 5],
      typicalStart: '18:00',
      typicalEnd: '20:00',
    });
    expect(athlete.sessionWindow).toEqual({ start: '17:00', end: '19:00' });
    expect(athlete.valgusControl).toEqual({
      required: true,
      sessionsPerWeek: 2,
      minHoursFromWall: 6,
    });
    expect(athlete.weakerSide).toBe('left');
    // Field by field over the shipped defaults, so a half-filled setting still
    // runs the gate rather than turning it off.
    expect(athlete.readinessConfig?.kind).toBe('cmj');
    expect(athlete.readinessConfig?.attempts).toBe(5);
    expect(athlete.readinessConfig?.whoopLowScore).toBe(defaultReadinessConfig().whoopLowScore);
  });

  it('gives an athlete who answered none of them the defaults', () => {
    const athlete = toEngineAthlete({ athlete: row(), pains: [], baseline: BASELINE });

    expect(athlete.secondaryGoal).toBeUndefined();
    expect(athlete.fingerHistory).toBe(false);
    expect(athlete.gripMode).toBe('any');
    expect(athlete.fingerPainCeiling).toBe(defaultFingerPainCeiling());
    expect(athlete.wallWork).toBeUndefined();
    expect(athlete.sessionWindow).toBeUndefined();
    // Off, not absent: `required: false` is what the placement rule reads.
    expect(athlete.valgusControl?.required).toBe(false);
    expect(athlete.weakerSide).toBeNull();
    expect(athlete.readinessConfig).toEqual(defaultReadinessConfig());
  });

  it('forces open hand when the athlete has a finger history and no grip answer', () => {
    const athlete = toEngineAthlete({
      athlete: row({ fingerHistory: true }),
      pains: [],
      baseline: BASELINE,
    });
    expect(athlete.gripMode).toBe('open_hand');
  });

  it('reads a finger pain row as an engine pain site', () => {
    const athlete = toEngineAthlete({
      athlete: row(),
      pains: [
        {
          id: 'pain-1',
          athleteId: 'athlete_owner',
          location: 'finger',
          severityRaw: 3,
          severityDerived: 'moderate',
          onset: 'chronic',
          durationWeeks: 20,
          houseRule: true,
          note: null,
          reportedAt: '2026-09-01T12:00:00.000Z',
          reassessDueAt: null,
          clearedAt: null,
        },
      ],
      baseline: BASELINE,
    });
    expect(athlete.painStatus.map((pain) => pain.location)).toEqual(['finger']);
  });
});

describe('the two wall answers and the best recent set', () => {
  it('carries the finger load and the same-day gap the athlete chose', () => {
    const athlete = toEngineAthlete({
      athlete: row({
        wallWork: {
          weekdays: [0, 2, 4],
          typicalStart: '18:00',
          typicalEnd: '20:00',
          fingerLoad: 'hard',
          sameDayGapHours: 8,
        },
        sessionWindow: { start: '08:00', end: '10:00' },
      }),
      pains: [],
      baseline: BASELINE,
    });
    expect(athlete.wallWork?.fingerLoad).toBe('hard');
    expect(athlete.wallWork?.sameDayGapHours).toBe(8);
  });

  it('leaves both off a row written before the questions existed', () => {
    const wall = readWallWork({ weekdays: [2] });
    // Absent, not defaulted here: the engine reads absent as hard and as its
    // own six hours, and inventing them in the bridge would hide that.
    expect(wall?.fingerLoad).toBeUndefined();
    expect(wall?.sameDayGapHours).toBeUndefined();
    expect(defaultWallGapHours()).toBe(6);
  });

  it('refuses a finger load and a gap that are not answers', () => {
    const wall = readWallWork({ weekdays: [2], fingerLoad: 'medium', sameDayGapHours: -3 });
    expect(wall?.fingerLoad).toBeUndefined();
    expect(wall?.sameDayGapHours).toBeUndefined();
  });

  it('carries a best recent set per lift into the engine athlete', () => {
    const athlete = toEngineAthlete({
      athlete: row({
        bestSets: {
          box_squat: { reps: 2, loadKg: lbToKg(305), rpe: 8.5, at: '2026-08-31' },
        },
      }),
      pains: [],
      baseline: BASELINE,
    });
    expect(athlete.bestSets?.['box_squat']).toEqual({
      reps: 2,
      loadKg: lbToKg(305),
      rpe: 8.5,
      at: '2026-08-31',
    });
  });

  it('leaves bestSets absent when the athlete typed none', () => {
    const athlete = toEngineAthlete({ athlete: row(), pains: [], baseline: BASELINE });
    expect(athlete.bestSets).toBeUndefined();
  });

  it('drops a half-typed set rather than guessing at it', () => {
    expect(readBestSets({ box_squat: { reps: 2, at: '2026-08-31' } })).toEqual({});
    expect(readBestSets({ box_squat: { reps: 0, loadKg: 100, at: '2026-08-31' } })).toEqual({});
    expect(readBestSets({ box_squat: { reps: 2, loadKg: 100 } })).toEqual({});
    expect(readBestSets('not an object')).toEqual({});
    // The effort is optional, so a set without one is still a set.
    expect(readBestSets({ box_squat: { reps: 3, loadKg: 100, at: '2026-08-24' } })).toEqual({
      box_squat: { reps: 3, loadKg: 100, at: '2026-08-24' },
    });
  });
});

describe('the narrowing readers', () => {
  it('refuses a wall-work document with no usable weekday', () => {
    expect(readWallWork(null)).toBeNull();
    expect(readWallWork({ weekdays: [] })).toBeNull();
    expect(readWallWork({ weekdays: ['Wednesday'] })).toBeNull();
    expect(readWallWork({ weekdays: [5, 3, 3, 9] })).toEqual({ weekdays: [3, 5] });
  });

  it('drops a clock time that is not one', () => {
    expect(readWallWork({ weekdays: [3], typicalStart: '6pm' })).toEqual({ weekdays: [3] });
  });

  it('reads a garbled valgus document as off rather than as required', () => {
    expect(readValgusControl('not an object').required).toBe(false);
    expect(readValgusControl({ required: true, sessionsPerWeek: -1 })).toMatchObject({
      required: true,
      sessionsPerWeek: 2,
    });
  });

  it('falls back to the shipped gate when the stored config is nonsense', () => {
    expect(readReadinessConfig({ kind: 'coin_toss' })).toEqual(defaultReadinessConfig());
  });
});

describe('the inventory bridge', () => {
  it('reads the three climbing answers, and absent reads as false', () => {
    const full = readInventory({
      barbell: true,
      rack: true,
      plates: { smallestPairLb: 5 },
      hangboard: true,
      boxSquatBox: true,
      climbingWall: true,
    });
    expect(full).toMatchObject({ hangboard: true, boxSquatBox: true, climbingWall: true });

    const bare = readInventory({ barbell: true, rack: true, plates: { smallestPairLb: 5 } });
    expect(bare).toMatchObject({ hangboard: false, boxSquatBox: false, climbingWall: false });
  });
});
