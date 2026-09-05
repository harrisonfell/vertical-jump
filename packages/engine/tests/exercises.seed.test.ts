import { describe, expect, it } from 'vitest';
import rawExercises from '../src/exercises/seed.json';
import rawLadders from '../src/exercises/ladders.json';
import {
  ExerciseValidationError,
  KNEE_HIGH_ALLOWED,
  LadderValidationError,
  indexById,
  loadExercises,
  validateExercise,
  validateLadder,
} from '../src/exercises/index.js';
import { loadRuleset } from '../src/ruleset/index.js';
import type { DayType, ExerciseRole, Level } from '../src/types/core.js';

const { exercises, ladders } = loadExercises();
const RULESET = loadRuleset();
const LADDER_IDS = new Set(ladders.map((ladder) => ladder.id));

const REQUIRED_TAGS = [
  'id', 'name', 'loadType', 'loadable', 'displayMode', 'stabilityDemand', 'kneeStress', 'spineStress',
  'shoulderStress', 'cnsCost', 'fatigueCost', 'equipment', 'requiresBarbell', 'movementPattern', 'plane',
  'unilateral', 'isAxialLoad', 'isOverhead', 'isPressing', 'isPush', 'isPull', 'repetitiveImpact',
  'isPulling', 'isRnt', 'isOlympicLift', 'technicalSkillHigh', 'intent', 'levelMin', 'roleCandidates',
  'isMainLift', 'defaultSets',
  'prefersLoadableInStrengthBlock', 'readinessRequired', 'cues', 'dayTypes', 'categoryForCharts',
];

describe('seed.json', () => {
  it('loads and validates', () => {
    expect(exercises.length).toBeGreaterThanOrEqual(44);
    expect(new Set(exercises.map((exercise) => exercise.id)).size).toBe(exercises.length);
  });

  it('carries every exercise the program needs by name', () => {
    const wanted = [
      'back_squat', 'trap_bar_deadlift', 'romanian_deadlift', 'front_squat', 'goblet_squat',
      'bulgarian_split_squat', 'walking_lunge', 'lateral_lunge', 'step_up', 'hip_thrust', 'nordic_curl',
      'single_leg_rdl', 'db_bench_press', 'barbell_bench_press', 'overhead_press', 'push_up', 'pull_up',
      'chin_up', 'db_row', 'inverted_row', 'face_pull', 'pallof_press', 'dead_bug', 'side_plank',
      'copenhagen_plank', 'heavy_slow_calf_raise', 'single_leg_calf_isometric', 'spanish_squat_isometric',
      'isometric_squat', 'eccentric_calf_lowering', 'pogo_hops', 'submax_cmj', 'depth_jump', 'hurdle_hop',
      'box_jump', 'broad_jump', 'single_leg_bound', 'tuck_jump', 'trap_bar_jump', 'med_ball_scoop_toss',
      'shuttle_5_10_5', 'cut_and_sprint_45', 'accel_sprint_10m', 'sprint_30m', 'hip_switch_90_90',
      'couch_stretch', 'worlds_greatest_stretch', 'foam_rolling', 'glute_bridge_activation',
      'banded_lateral_walk', 'a_skip', 'wall_ankle_mobilization', 'thoracic_rotation',
      'rotational_med_ball_throw', 'cossack_squat',
    ];
    const byId = indexById(exercises);
    for (const id of wanted) expect(byId.has(id), `missing ${id}`).toBe(true);
  });

  it('fails validation when any required tag is missing', () => {
    const first = (rawExercises as Record<string, unknown>[])[0];
    expect(first).toBeDefined();
    for (const tag of REQUIRED_TAGS) {
      const copy = { ...first };
      delete copy[tag];
      expect(() => validateExercise(copy, LADDER_IDS), `dropping ${tag} must throw`)
        .toThrow(ExerciseValidationError);
    }
  });

  it('reserves knee stress high for depth jumps, maximal bounds and heavy bilateral squats', () => {
    const kneeHigh = exercises.filter((exercise) => exercise.kneeStress === 'high').map((e) => e.id);
    expect(kneeHigh.slice().sort()).toEqual(KNEE_HIGH_ALLOWED.slice().sort());
    const copy = { ...(rawExercises as Record<string, unknown>[])[1], id: 'walking_lunge', kneeStress: 'high' };
    expect(() => validateExercise(copy, LADDER_IDS)).toThrow(/reserved/);
  });

  it('gives every plyometric a full contact profile', () => {
    for (const exercise of exercises) {
      const plyo = exercise.plyometric;
      if (plyo === undefined) continue;
      expect(plyo.contactsPerRep, exercise.id).toBeGreaterThanOrEqual(1);
      expect(['low', 'high']).toContain(plyo.amplitude);
      expect(['low', 'moderate', 'high']).toContain(plyo.intensity);
      expect(['extensive', 'intensive']).toContain(plyo.category);
      if (plyo.ladderId !== undefined) expect(LADDER_IDS.has(plyo.ladderId), exercise.id).toBe(true);
    }
    const depth = exercises.find((exercise) => exercise.id === 'depth_jump');
    expect(depth?.plyometric?.contactsPerRep).toBe(2);
    expect(depth?.plyometric?.intensity).toBe('high');
    expect(depth?.plyometric?.amplitude).toBe('high');
    expect(depth?.readinessRequired).toBe(true);
    expect(depth?.dropHeightCapIn).toBe(24);
    expect(exercises.find((e) => e.id === 'shuttle_5_10_5')?.codCutsPerRep).toBe(2);
  });

  it('gives every exercise 2 to 4 second-person cues and no video yet', () => {
    for (const exercise of exercises) {
      expect(exercise.cues.length, exercise.id).toBeGreaterThanOrEqual(2);
      expect(exercise.cues.length, exercise.id).toBeLessThanOrEqual(4);
      expect(exercise.videoUrl).toBeUndefined();
      for (const cue of exercise.cues) expect(cue).not.toContain('—');
    }
  });
});

describe('ladders.json', () => {
  it('gives every ladder an equipment-free rank 0', () => {
    for (const ladder of ladders) {
      expect(ladder.rungs[0]?.rank).toBe(0);
      expect(ladder.rungs[0]?.equipment).toEqual([]);
    }
    expect(ladders.find((ladder) => ladder.id === 'depth_jump_height')?.rungs.map((r) => r.heightIn))
      .toEqual([12, 12, 18, 24]);
    expect(ladders.find((ladder) => ladder.id === 'hurdle_hop_height')?.rungs.map((r) => r.heightIn))
      .toEqual([undefined, 6, 9, 12]);
    expect(ladders.find((ladder) => ladder.id === 'box_jump_height')?.rungs.map((r) => r.heightIn))
      .toEqual([undefined, 18, 24, 30]);
  });

  it('rejects a ladder whose rank 0 needs equipment', () => {
    const first = (rawLadders as Record<string, unknown>[])[0];
    const broken = JSON.parse(JSON.stringify(first)) as { rungs: { equipment: string[] }[] };
    const rank0 = broken.rungs[0];
    if (rank0 !== undefined) rank0.equipment = ['box'];
    expect(() => validateLadder(broken)).toThrow(LadderValidationError);
  });
});

describe('role and day coverage', () => {
  const ROLES: ExerciseRole[] = [
    'main_lift', 'secondary', 'accessory', 'injury_prevention', 'core', 'conditioning', 'warm_up',
    'cool_down', 'mobility', 'primer', 'power_jump', 'cod', 'tendon', 'activation', 'soft_tissue',
  ];

  it('covers every role', () => {
    for (const role of ROLES) {
      expect(exercises.some((exercise) => exercise.roleCandidates.includes(role)), role).toBe(true);
    }
  });

  it('covers warm-up, cool-down and a primary role on every day type at every level, with and without a barbell', () => {
    const DAY_TYPES: DayType[] = [
      'full_body_strength', 'lower_strength', 'upper_strength', 'upper_mobility',
      'power_speed', 'power', 'speed', 'recovery_mobility',
    ];
    const LEVELS: Level[] = ['beginner', 'intermediate', 'advanced'];
    const RANK: Record<Level, number> = { beginner: 0, intermediate: 1, advanced: 2 };
    const STRESS: Record<string, number> = { low: 0, moderate: 1, high: 2 };

    for (const dayType of DAY_TYPES) {
      for (const level of LEVELS) {
        for (const barbell of [true, false]) {
          const ceiling = RULESET.constants.stabilityCeiling[level];
          const pool = exercises.filter(
            (exercise) =>
              exercise.dayTypes.includes(dayType) &&
              RANK[exercise.levelMin] <= RANK[level] &&
              (STRESS[exercise.stabilityDemand] ?? 0) <= (STRESS[ceiling] ?? 2) &&
              (barbell || !exercise.requiresBarbell),
          );
          const label = `${dayType}/${level}/${barbell ? 'gym' : 'home'}`;
          const has = (role: ExerciseRole): boolean => pool.some((e) => e.roleCandidates.includes(role));
          expect(has('warm_up'), `${label} warm-up`).toBe(true);
          expect(has('cool_down') || has('mobility'), `${label} cool-down`).toBe(true);
          if (dayType === 'recovery_mobility') {
            expect(has('soft_tissue') && has('activation'), `${label} recovery`).toBe(true);
          } else if (dayType === 'power_speed' || dayType === 'power' || dayType === 'speed') {
            expect(has('power_jump'), `${label} power`).toBe(true);
            expect(has('tendon'), `${label} tendon`).toBe(true);
          } else {
            expect(has('main_lift'), `${label} main lift`).toBe(true);
            expect(has('accessory'), `${label} accessory`).toBe(true);
            expect(has('injury_prevention'), `${label} injury prevention`).toBe(true);
          }
        }
      }
    }
  });
});
