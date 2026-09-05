/**
 * The speed-climbing contract: the seed's new rows with every required tag,
 * the sport gate that keeps every other sport's pool exactly where it was, the
 * asymmetry helpers, and the signatures the implementers still owe.
 *
 * Everything an implementer builds against is asserted here, so a contract
 * change that breaks a downstream module fails in this file first.
 */
import { describe, expect, it } from 'vitest';

import { RULESET_V1, findHouseRule } from '../src/ruleset/index.js';
import { indexById, loadExercises } from '../src/exercises/index.js';
import {
  fingerSpacingOk,
  isHardFingerExercise,
  placeRnt,
  sportAllows,
  sportRequirementsFor,
} from '../src/select/sport.js';
import { adjustmentFor, scoreReadiness } from '../src/readiness/index.js';
import { addedLoadPrescription } from '../src/prescribe/pullUp.js';
import { asymmetryPct, weakerSideFrom } from '../src/analytics/asymmetry.js';
import { climberAthlete } from '../src/fixtures/climber.js';
import { planSkeleton } from '../src/skeleton/index.js';
import { lbToKg } from '../src/units.js';
import type { Sport } from '../src/types/core.js';
import type { ReadinessState, SingleLegTest } from '../src/types/readiness.js';

const { exercises } = loadExercises();
const byId = indexById(exercises);
const climbing = RULESET_V1.constants.climbing;

/** Every row the climbing house rules add. All of them are sport-gated. */
const NEW_EXERCISE_IDS = [
  'box_squat', 'jump_squat', 'barbell_jump', 'seated_jump', 'depth_pause_jump', 'approach_jump',
  'quick_contact_rsi_jump', 'cmj_test', 'cmj_readiness_check', 'rsi_hop_check', 'squat_jump',
  'weighted_pull_up', 'weighted_pull_up_cluster',
  'explosive_pull_up', 'band_assisted_overspeed_pull', 'hangboard_open_hand_hang',
  'med_ball_chest_throw', 'seated_med_ball_throw', 'med_ball_overhead_slam',
  'med_ball_rotational_throw', 'push_press', 'db_press', 'rnt_split_squat', 'rnt_step_down',
  'pull_up_open_hand', 'db_row_open_hand',
];

describe('the climbing seed', () => {
  it('carries every new exercise with every required tag', () => {
    for (const id of NEW_EXERCISE_IDS) {
      const exercise = byId.get(id);
      expect(exercise, id).toBeDefined();
      if (exercise === undefined) continue;
      expect(exercise.sports, id).toEqual(['speed_climbing']);
      expect(exercise.cues.length, id).toBeGreaterThanOrEqual(2);
      expect(exercise.dayTypes.length, id).toBeGreaterThanOrEqual(1);
      expect(exercise.roleCandidates.length, id).toBeGreaterThanOrEqual(1);
      expect(typeof exercise.isPulling, id).toBe('boolean');
      expect(typeof exercise.isRnt, id).toBe('boolean');
    }
  });

  it('tags the rows the house rules name by name', () => {
    expect(byId.get('box_squat')?.loadType).toBe('heavy_strength');
    expect(byId.get('box_squat')?.isMainLift).toBe(true);
    expect(byId.get('box_squat')?.equipment).toContain('box_squat_box');
    expect(byId.get('jump_squat')?.ballisticCapPct).toBe(30);
    expect(byId.get('barbell_jump')?.loadType).toBe('ballistic');
    expect(byId.get('barbell_jump')?.ballisticCapPct).toBe(30);
    expect(byId.get('seated_jump')?.plyometric?.amplitude).toBe('low');
    expect(byId.get('seated_jump')?.plyometric?.category).toBe('intensive');
    expect(byId.get('depth_pause_jump')?.plyometric?.ladderId).toBe('depth_jump_height');
    expect(byId.get('depth_pause_jump')?.readinessRequired).toBe(true);
    expect(byId.get('approach_jump')?.plyometric?.intensity).toBe('high');
    expect(byId.get('quick_contact_rsi_jump')?.plyometric?.contactTime).toBe('fast');
    expect(byId.get('weighted_pull_up')?.isMainLift).toBe(true);
    expect(byId.get('weighted_pull_up_cluster')?.cues.join(' ')).toContain('Cluster');
    expect(byId.get('hangboard_open_hand_hang')?.tendonTarget).toBe('finger');
    expect(byId.get('hangboard_open_hand_hang')?.holdSecondsRange).toEqual({ minS: 7, maxS: 10 });
    expect(byId.get('med_ball_rotational_throw')?.plane).toBe('transverse');
    expect(byId.get('push_press')?.loadType).toBe('strength_speed');
    expect(byId.get('push_press')?.shoulderStress).toBe('moderate');
    expect(byId.get('db_press')?.loadType).toBe('hypertrophy');
    expect(byId.get('rnt_step_down')?.equipment).toContain('box');
  });

  it('gives the readiness tests their kind and metric', () => {
    expect(byId.get('seated_med_ball_throw')?.readinessTest)
      .toEqual({ kind: 'seated_mb_throw', metric: 'distance_m' });
    expect(byId.get('cmj_test')?.readinessTest).toEqual({ kind: 'cmj', metric: 'height_in' });
  });

  it('gives every pulling exercise a grip and a finger load', () => {
    const pulling = exercises.filter((exercise) => exercise.isPulling);
    expect(pulling.length).toBeGreaterThanOrEqual(7);
    for (const exercise of pulling) {
      expect(exercise.gripMode, exercise.id).toBeDefined();
      expect(exercise.fingerLoad, exercise.id).toBeDefined();
    }
    expect(byId.get('pull_up')?.gripMode).toBe('any');
    expect(byId.get('chin_up')?.gripMode).toBe('any');
    expect(byId.get('db_row')?.gripMode).toBe('any');
    expect(byId.get('pull_up_open_hand')?.gripMode).toBe('open_hand');
    expect(byId.get('db_row_open_hand')?.gripMode).toBe('open_hand');
  });

  it('marks the hard finger rows and gives every RNT row an alignment protocol', () => {
    for (const id of ['weighted_pull_up', 'weighted_pull_up_cluster', 'explosive_pull_up',
      'band_assisted_overspeed_pull', 'hangboard_open_hand_hang']) {
      const exercise = byId.get(id);
      expect(exercise?.fingerLoad, id).toBe('hard');
      expect(exercise === undefined ? false : isHardFingerExercise(exercise), id).toBe(true);
    }
    const rnt = exercises.filter((exercise) => exercise.isRnt);
    expect(rnt.map((exercise) => exercise.id)).toEqual(['rnt_split_squat', 'rnt_step_down']);
    for (const exercise of rnt) {
      expect(exercise.valgusProtocol, exercise.id).toEqual({ repTermination: 'alignment' });
      expect(exercise.sideOrder, exercise.id).toBe('weaker_first');
      expect(exercise.unilateral, exercise.id).toBe(true);
      expect(exercise.roleCandidates, exercise.id).toContain('injury_prevention');
    }
  });
});

describe('the sport gate', () => {
  const OTHER_SPORTS: Sport[] = ['basketball', 'football', 'soccer', 'track_field', 'volleyball',
    'baseball', 'none'];

  it('leaves every other sport with exactly the pool it had', () => {
    for (const sport of OTHER_SPORTS) {
      const allowed = exercises.filter((exercise) => sportAllows(exercise, sport));
      expect(allowed.length, sport).toBe(exercises.length - NEW_EXERCISE_IDS.length);
      expect(allowed.some((exercise) => exercise.id === 'weighted_pull_up'), sport).toBe(false);
      const requirements = sportRequirementsFor(sport, RULESET_V1);
      expect(requirements.allowsConditioningBlock, sport).toBe(true);
      expect(requirements.upperDayIntent, sport).toBe('strength');
      expect(requirements.upperPowerSessionsPerWeek, sport).toBe(0);
      expect(requirements.jumpOrReactiveSessionsPerWeek, sport).toBe(0);
    }
    expect(sportRequirementsFor('basketball', RULESET_V1).requiresCod).toBe(true);
    expect(sportRequirementsFor('soccer', RULESET_V1).requiresCod).toBe(true);
    expect(sportRequirementsFor('football', RULESET_V1).sprintClass).toBe('acceleration');
    expect(sportRequirementsFor('track_field', RULESET_V1).sprintClass).toBe('max_velocity');
  });

  it('asks speed climbing for a jump day, an upper power day and acceleration work', () => {
    expect(sportRequirementsFor('speed_climbing', RULESET_V1)).toEqual({
      sport: 'speed_climbing',
      requiresCod: false,
      // R102 and R113: the wall is an acceleration event and speed is the
      // second goal. The conditioning BLOCK is still never added, so the
      // sprint runs inside the Power block.
      sprintClass: 'acceleration',
      jumpOrReactiveSessionsPerWeek: 1,
      upperPowerSessionsPerWeek: 1,
      allowsConditioningBlock: false,
      upperDayIntent: 'upper_power',
      houseRuleId: 'house.sc.sport_requirements',
    });
    expect(findHouseRule(RULESET_V1, 'house.sc.sport_requirements')).toBeDefined();
    expect(exercises.filter((exercise) => sportAllows(exercise, 'speed_climbing')).length)
      .toBe(exercises.length);
  });
});

describe('readiness and asymmetry', () => {
  it('looks the adjustment up from the ruleset for every state', () => {
    const states: ReadinessState[] = [
      'both_high', 'autonomic_low', 'neuromuscular_low', 'both_low', 'unknown',
    ];
    for (const state of states) {
      expect(adjustmentFor(state, RULESET_V1), state).toBe(climbing.readinessAdjustments[state]);
    }
    expect(adjustmentFor('both_high', RULESET_V1)).toEqual({
      tierDown: false, holdVolume: false, removeMaximalJumps: false,
      jumpVolumeFactor: 1, loadFactor: 1, extraReps: 0, offerRecoverySwap: false,
    });
    expect(adjustmentFor('autonomic_low', RULESET_V1).holdVolume).toBe(true);
    expect(adjustmentFor('neuromuscular_low', RULESET_V1)).toMatchObject({
      tierDown: true, removeMaximalJumps: true, jumpVolumeFactor: 0.75, loadFactor: 1,
    });
    expect(adjustmentFor('both_low', RULESET_V1)).toMatchObject({
      tierDown: true, removeMaximalJumps: true, loadFactor: 0.9, extraReps: 2,
      offerRecoverySwap: true,
    });
  });

  it('reads asymmetry as a signed share of the better leg', () => {
    expect(asymmetryPct(30, 30)).toBe(0);
    expect(asymmetryPct(0, 30)).toBe(0);
    expect(asymmetryPct(30, 27)).toBeCloseTo(10, 6);
    expect(asymmetryPct(27, 30)).toBeCloseTo(-10, 6);
  });

  it('names the weaker side from the latest test, else from the answer', () => {
    const base: SingleLegTest = {
      date: '2026-09-01',
      instrument: 'ovr_jump_regular',
      leftIn: 30,
      rightIn: 27,
      asymmetryPct: asymmetryPct(30, 27),
      weakerSide: 'right',
    };
    const band = climbing.asymmetryBandPct;
    expect(weakerSideFrom([base], null, band)).toBe('right');
    expect(weakerSideFrom([base, { ...base, date: '2026-10-01', asymmetryPct: -8 }], null, band))
      .toBe('left');
    expect(weakerSideFrom([{ ...base, asymmetryPct: 1 }], 'left', band)).toBe('left');
    expect(weakerSideFrom([], 'left', band)).toBe('left');
    expect(weakerSideFrom([], null, band)).toBeNull();
  });
});

describe('the logic the implementers still owe', () => {
  it('declares every signature and throws until it is filled', () => {
    // The readiness gate and the asymmetry helpers are filled in; their own
    // behaviour is asserted in tests/readiness.*.test.ts and asymmetry.test.ts.
    expect(scoreReadiness(climbing.readiness, null, null, [], RULESET_V1).state).toBe('unknown');
    // The selection placements are filled in; their own behaviour is asserted
    // in tests/select.climbing.test.ts.
    expect(fingerSpacingOk([], 0, climbing.fingerSpacingHours)).toBe(true);
    expect(placeRnt({ sessions: [] } as never, {} as never, RULESET_V1)).toEqual({
      sessionIds: [],
      lines: [],
    });
    // Block 6 on added load is filled in; its own behaviour is asserted in
    // src/prescribe/prescribe.pullUp.test.ts.
    const pullUp = byId.get('weighted_pull_up');
    const week = planSkeleton(climberAthlete(), '2026-09-07', RULESET_V1).weeks[1];
    expect(pullUp).toBeDefined();
    expect(week).toBeDefined();
    if (pullUp === undefined || week === undefined) return;
    const rows = addedLoadPrescription(pullUp, climberAthlete(), {
      w: week.w,
      kind: week.kind,
      blockType: week.blockType,
      k: week.k,
      targets: week.targets,
      isFirstProgramWeek1: false,
      isFirstPercentWeekForLift: false,
      sets: 3,
      ruleset: RULESET_V1,
      workingMax: {
        lift: 'weighted_pull_up',
        valueKg: lbToKg(60),
        source: 'epley',
        confidence: 1,
        frozenAt: '2026-09-14T03:00:00.000Z',
        failStreak: 0,
      },
    });
    // Only the added load is prescribed: bodyweight is not on the 5 lb grid.
    expect(rows.map((row) => row.displayLoad)).toEqual([
      '5 × BW + 45 lb',
      '4 × BW + 50 lb',
      '3 × BW + 50 lb',
    ]);
  });
});
