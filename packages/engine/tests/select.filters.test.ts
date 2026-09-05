import { describe, expect, it } from 'vitest';
import { loadRuleset } from '../src/ruleset/index.js';
import { loadExercises } from '../src/exercises/index.js';
import { mulberry32 } from '../src/prng.js';
import {
  applyBlock1,
  depthJumpEligibility,
  hasEquipment,
  levelAllows,
  resolveLadderRung,
} from '../src/select/filters.js';
import type { FilterOptions } from '../src/select/filters.js';
import { deriveSeverity, evaluatePainGate } from '../src/select/painGate.js';
import {
  applyR111Swap,
  consecutiveWeeks,
  needsRotation,
  rotateStaleExercises,
  rotationNoteText,
} from '../src/select/rotation.js';
import { displayedRows, satisfyPairings, trimToDisplayCap } from '../src/select/trim.js';
import type { PlacedRow } from '../src/select/trim.js';
import type { ClearanceAnswers, Inventory, PainStatus } from '../src/types/athlete.js';
import type { Level, PainLocation, PainSeverityRaw } from '../src/types/core.js';

const RULESET = loadRuleset();
const { exercises, ladders } = loadExercises();
const TODAY = '2026-10-19';

const CLEAN: ClearanceAnswers = {
  heartCondition: false,
  chestPain: false,
  dizziness: false,
  chronicCondition: false,
  prescriptionMedication: false,
  boneOrJointProblem: false,
  supervisedActivityOnly: false,
  isAdult: true,
};

function inventory(overrides: Partial<Inventory> = {}): Inventory {
  return {
    barbell: true,
    rack: true,
    plates: { smallestPairLb: 2.5 },
    trapBar: true,
    dumbbells: { maxLb: 100, incrementLb: 5 },
    kettlebells: false,
    boxHeightsIn: [12, 18, 24, 30],
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

const HOME = inventory({
  barbell: false,
  rack: false,
  trapBar: false,
  weightRoomAccess: false,
});

const BARE = inventory({
  barbell: false,
  rack: false,
  trapBar: false,
  dumbbells: null,
  boxHeightsIn: [],
  hurdleHeightsIn: [],
  bands: false,
  medBall: false,
  bench: false,
  pullupBar: false,
  weightRoomAccess: false,
});

function pain(location: PainLocation, raw: PainSeverityRaw): PainStatus {
  return {
    location,
    severityRaw: raw,
    severity: deriveSeverity(raw),
    duration: 'chronic',
    durationWeeks: 30,
    reportedAt: '2026-01-01',
    reassessDueAt: '2026-11-01',
  };
}

function gate(painStatus: PainStatus[] = [], isAdult = true) {
  return evaluatePainGate({ clearance: CLEAN, painStatus, isAdult, today: TODAY }, RULESET);
}

const POWER_OPTIONS: FilterOptions = {
  dayType: 'power_speed',
  blockType: 'power',
  weekKind: 'load',
  isFirstBlock: false,
  readinessPassedAt: '2026-08-01',
  sessionDate: '2026-10-22',
  targetDate: '2026-11-29',
  bodyweightLb: 185,
  ruleset: RULESET,
};

const ids = (level: Level, inv: Inventory, options: FilterOptions, painStatus: PainStatus[] = []): string[] =>
  applyBlock1(exercises, gate(painStatus), inv, level, options).map((exercise) => exercise.id);

describe('equipment (R19, R45, R46)', () => {
  it('excludes barbell lifts without weight-room access', () => {
    const home = ids('advanced', HOME, { dayType: 'lower_strength', ruleset: RULESET });
    expect(home).not.toContain('back_squat');
    expect(home).not.toContain('romanian_deadlift');
    expect(home).not.toContain('hip_thrust');
    expect(home).toContain('goblet_squat');
    expect(home).toContain('bulgarian_split_squat');
    const gym = ids('advanced', inventory(), { dayType: 'lower_strength', ruleset: RULESET });
    expect(gym).toContain('back_squat');
  });

  it('excludes a trap bar the athlete does not own', () => {
    expect(ids('advanced', HOME, { dayType: 'lower_strength', ruleset: RULESET })).not.toContain('trap_bar_deadlift');
  });

  it('still leaves a warm-up, a main lift and a core row with nothing but a floor', () => {
    const bare = ids('advanced', BARE, { dayType: 'full_body_strength', ruleset: RULESET });
    expect(bare).toContain('push_up');
    expect(bare).toContain('dead_bug');
    expect(bare).toContain('hip_switch_90_90');
  });

  it('checks every tag an exercise names', () => {
    expect(hasEquipment(HOME, ['dumbbell', 'bench'])).toBe(true);
    expect(hasEquipment(HOME, ['barbell'])).toBe(false);
    expect(hasEquipment(BARE, [])).toBe(true);
    expect(hasEquipment(BARE, ['none'])).toBe(true);
  });
});

describe('level ceilings (R53 to R56)', () => {
  it('excludes advanced exercises and high stability demand for a beginner', () => {
    const beginner = ids('beginner', inventory(), { dayType: 'lower_strength', ruleset: RULESET });
    expect(beginner).not.toContain('front_squat');
    expect(beginner).not.toContain('bulgarian_split_squat');
    expect(beginner).not.toContain('single_leg_rdl');
    expect(beginner).toContain('goblet_squat');
    expect(beginner).toContain('walking_lunge');
  });

  it('allows high stability from intermediate up', () => {
    expect(ids('intermediate', inventory(), { dayType: 'lower_strength', ruleset: RULESET }))
      .toContain('bulgarian_split_squat');
    expect(ids('intermediate', inventory(), { dayType: 'lower_strength', ruleset: RULESET }))
      .not.toContain('front_squat');
    expect(ids('advanced', inventory(), { dayType: 'lower_strength', ruleset: RULESET }))
      .toContain('front_squat');
  });

  it('reads the ceiling straight off the ruleset', () => {
    const front = exercises.find((exercise) => exercise.id === 'front_squat');
    expect(front).toBeDefined();
    if (front === undefined) return;
    expect(levelAllows(front, 'advanced', 'high')).toBe(true);
    expect(levelAllows(front, 'intermediate', 'high')).toBe(false);
  });
});

describe('pain exclusions', () => {
  it('drops every knee-stress lift and every jump on severe knee pain (R3)', () => {
    const pool = ids('advanced', inventory(), POWER_OPTIONS, [pain('knee', '5+')]);
    expect(pool).not.toContain('depth_jump');
    expect(pool).not.toContain('box_jump');
    expect(pool).not.toContain('hurdle_hop');
  });

  it('drops high-intensity plyometrics on moderate Achilles pain (R17)', () => {
    const pool = ids('advanced', inventory(), POWER_OPTIONS, [pain('achilles_calf', '3-4')]);
    expect(pool).not.toContain('depth_jump');
    expect(pool).not.toContain('broad_jump');
    expect(pool).toContain('box_jump');
  });

  it('drops repetitive impact work on severe shin pain (R7)', () => {
    const pool = ids('advanced', inventory(), POWER_OPTIONS, [pain('shin', '5+')]);
    expect(pool).not.toContain('hurdle_hop');
    expect(pool).not.toContain('accel_sprint_10m');
  });

  it('drops overhead and pressing work on severe shoulder pain (R13)', () => {
    const pool = ids('advanced', inventory(), { dayType: 'upper_strength', ruleset: RULESET }, [pain('shoulder', '5+')]);
    expect(pool).not.toContain('overhead_press');
    expect(pool).not.toContain('push_up');
    expect(pool).toContain('db_row');
  });

  it('drops axial loading on severe back pain (R10)', () => {
    const pool = ids('advanced', inventory(), { dayType: 'lower_strength', ruleset: RULESET }, [pain('back', '5+')]);
    expect(pool).not.toContain('back_squat');
    expect(pool).not.toContain('trap_bar_deadlift');
  });
});

describe('depth-jump readiness and drop heights', () => {
  it('allows depth jumps only when every gate passes', () => {
    expect(depthJumpEligibility(gate(), 'advanced', POWER_OPTIONS).allowed).toBe(true);
  });

  it('refuses beginners, first blocks, the Strength block, reduced weeks and the last four days', () => {
    const cases: [string, Level, FilterOptions][] = [
      ['beginner', 'beginner', POWER_OPTIONS],
      ['first block', 'advanced', { ...POWER_OPTIONS, isFirstBlock: true }],
      ['strength block', 'advanced', { ...POWER_OPTIONS, blockType: 'strength' }],
      ['deload', 'advanced', { ...POWER_OPTIONS, weekKind: 'deload' }],
      ['taper', 'advanced', { ...POWER_OPTIONS, weekKind: 'taper' }],
      ['near target', 'advanced', { ...POWER_OPTIONS, sessionDate: '2026-11-27' }],
    ];
    for (const [label, level, options] of cases) {
      const verdict = depthJumpEligibility(gate(), level, options);
      expect(verdict.allowed, label).toBe(false);
      expect(verdict.reason.length, label).toBeGreaterThan(0);
      expect(ids(level, inventory(), options)).not.toContain('depth_jump');
    }
  });

  it('refuses without the readiness checklist and with lower-limb pain', () => {
    const noChecklist: FilterOptions = { ...POWER_OPTIONS };
    delete noChecklist.readinessPassedAt;
    expect(depthJumpEligibility(gate(), 'advanced', noChecklist).allowed).toBe(false);
    expect(depthJumpEligibility(gate([pain('hip', '1-2')]), 'advanced', POWER_OPTIONS).allowed).toBe(false);
  });

  it('resolves a ladder rung down to what the inventory and the drop cap allow', () => {
    const depthLadder = ladders.find((ladder) => ladder.id === 'depth_jump_height');
    const depthJump = exercises.find((exercise) => exercise.id === 'depth_jump');
    expect(depthLadder).toBeDefined();
    if (depthLadder === undefined || depthJump === undefined) return;
    expect(resolveLadderRung(depthLadder, 3, inventory(), 185, depthJump).heightIn).toBe(24);
    // Over 220 lb the cap drops to 18 in.
    expect(resolveLadderRung(depthLadder, 3, inventory(), 240, depthJump).heightIn).toBe(18);
    // Unknown bodyweight is treated as heavy.
    expect(resolveLadderRung(depthLadder, 3, inventory(), null, depthJump).heightIn).toBe(18);
    // No boxes at all falls back to the equipment-free rank 0.
    expect(resolveLadderRung(depthLadder, 3, BARE, 185, depthJump).rank).toBe(0);
    // A box the athlete does not own is skipped.
    const small = inventory({ boxHeightsIn: [12] });
    expect(resolveLadderRung(depthLadder, 3, small, 185, depthJump).heightIn).toBe(12);
  });

  it('always resolves to a rung the athlete can actually do', () => {
    for (const ladder of ladders) {
      expect(resolveLadderRung(ladder, 0, BARE, null).rank).toBe(0);
      const resolved = resolveLadderRung(ladder, 3, BARE, null);
      expect(hasEquipment(BARE, resolved.equipment), ladder.id).toBe(true);
    }
  });
});

function row(id: string, overrides: Partial<PlacedRow> = {}): PlacedRow {
  const exercise = exercises.find((entry) => entry.id === id);
  if (exercise === undefined) throw new Error(`no exercise ${id}`);
  return {
    exercise,
    block: 'accessory',
    role: 'accessory',
    grouped: false,
    precedence: 30,
    required: false,
    ...overrides,
  };
}

describe('rotation (R57, R110, R111)', () => {
  it('counts consecutive weeks up to the week being built', () => {
    expect(consecutiveWeeks({ walking_lunge: [4, 5, 6] }, 'walking_lunge', 7)).toBe(3);
    expect(consecutiveWeeks({ walking_lunge: [3, 5, 6] }, 'walking_lunge', 7)).toBe(2);
    expect(consecutiveWeeks({}, 'walking_lunge', 7)).toBe(0);
  });

  it('rotates an accessory after three consecutive weeks and names what it replaced', () => {
    const context = {
      w: 7,
      rotationHistory: { walking_lunge: [4, 5, 6] },
      rotationWeeks: RULESET.constants.accessoryRotationWeeks,
      plateau: false,
      blockTransition: false,
      workingMaxUp10: false,
      prng: mulberry32(7),
    };
    expect(needsRotation('walking_lunge', context)).toBe(true);
    const result = rotateStaleExercises([row('walking_lunge')], exercises, context);
    const replacement = result.rows[0]?.exercise.id;
    expect(replacement).not.toBe('walking_lunge');
    expect(replacement).toBeDefined();
    if (replacement === undefined) return;
    expect(result.notes[replacement]).toBe(rotationNoteText('Walking lunge', 3));
    expect(result.notes[replacement]).toContain('New this week · replaces');
  });

  it('keeps a main lift inside a block and only rotates it on a plateau at a transition', () => {
    const base = {
      w: 7,
      rotationHistory: { back_squat: [1, 2, 3, 4, 5, 6] },
      rotationWeeks: RULESET.constants.accessoryRotationWeeks,
      plateau: false,
      blockTransition: false,
      workingMaxUp10: false,
      prng: mulberry32(7),
    };
    const main = row('back_squat', { block: 'main_lift', role: 'main_lift', precedence: 90 });
    expect(rotateStaleExercises([main], exercises, base).rows[0]?.exercise.id).toBe('back_squat');
    expect(rotateStaleExercises([main], exercises, { ...base, plateau: true }).rows[0]?.exercise.id).toBe('back_squat');
    const rotated = rotateStaleExercises([main], exercises, { ...base, plateau: true, blockTransition: true });
    expect(rotated.rows[0]?.exercise.id).not.toBe('back_squat');
  });

  it('swaps the lowest-precedence accessory for velocity work when a max is up 10 percent (R111)', () => {
    const context = {
      w: 7,
      rotationHistory: {},
      rotationWeeks: RULESET.constants.accessoryRotationWeeks,
      plateau: false,
      blockTransition: false,
      workingMaxUp10: true,
      prng: mulberry32(7),
    };
    const rows = [
      row('back_squat', { block: 'main_lift', role: 'main_lift', precedence: 90 }),
      row('walking_lunge', { precedence: 30 }),
    ];
    const result = applyR111Swap(rows, exercises, context);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.exercise.id).toBe('back_squat');
    expect(result.rows[1]?.exercise.id).not.toBe('walking_lunge');
    expect(result.rows[1]?.exercise.intent).toBe('velocity');
    expect(Object.values(result.notes)[0]).toContain('working max is up 10 percent');
  });
});

describe('pairings and the display cap', () => {
  it('adds a pull when the session only has pushes', () => {
    const result = satisfyPairings([row('push_up', { block: 'main_lift', role: 'main_lift' })], exercises, {
      requireTendon: false,
      canAdd: () => true,
      choose: (candidates) => candidates[0],
      repairPrecedence: 65,
    });
    expect(result.rows.some((entry) => entry.exercise.isPull)).toBe(true);
    expect(result.unmet).not.toContain('a pull to balance the pressing');
  });

  it('reports what it could not fit', () => {
    const result = satisfyPairings([row('push_up', { block: 'main_lift', role: 'main_lift' })], [], {
      requireTendon: true,
      canAdd: () => true,
      choose: (candidates) => candidates[0],
      repairPrecedence: 65,
    });
    expect(result.unmet).toContain('a pull to balance the pressing');
    expect(result.unmet).toContain('a tendon loading exercise');
  });

  it('counts a grouped block as one row and excludes warm-up and cool-down', () => {
    const rows: PlacedRow[] = [
      row('hip_switch_90_90', { block: 'warm_up', role: 'warm_up', grouped: true }),
      row('thoracic_rotation', { block: 'warm_up', role: 'warm_up', grouped: true }),
      row('pogo_hops', { block: 'primer', role: 'primer', grouped: true }),
      row('submax_cmj', { block: 'primer', role: 'primer', grouped: true }),
      row('walking_lunge'),
    ];
    expect(displayedRows(rows)).toBe(2);
  });

  it('trims the lowest-precedence accessory first and never a required row', () => {
    const rows: PlacedRow[] = [
      row('back_squat', { block: 'main_lift', role: 'main_lift', precedence: 90, required: true }),
      row('romanian_deadlift', { block: 'secondary', role: 'secondary', precedence: 60 }),
      row('walking_lunge', { precedence: 30 }),
      row('lateral_lunge', { precedence: 30 }),
      row('step_up', { precedence: 30 }),
    ];
    const result = trimToDisplayCap(rows, 3);
    expect(result.rows).toHaveLength(3);
    expect(result.trimmed).toHaveLength(2);
    expect(result.rows.map((entry) => entry.exercise.id)).toContain('back_squat');
    expect(result.rows.map((entry) => entry.exercise.id)).toContain('romanian_deadlift');
    for (const entry of result.trimmed) expect(entry.reason).toContain('3 exercises');
  });
});
