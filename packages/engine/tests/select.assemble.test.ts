import { describe, expect, it } from 'vitest';
import { loadRuleset } from '../src/ruleset/index.js';
import { loadExercises } from '../src/exercises/index.js';
import { mulberry32 } from '../src/prng.js';
import { CONTACT_CAPS } from '../src/budgets.js';
import { evaluatePainGate } from '../src/select/painGate.js';
import { codDayTypeFor, jumpDayTypeFor } from '../src/select/order.js';
import { selectSession } from '../src/select/assemble.js';
import type { SelectContext } from '../src/select/assemble.js';
import type { Athlete, ClearanceAnswers, Inventory, PainStatus } from '../src/types/athlete.js';
import type { DayType, Level, Sport } from '../src/types/core.js';
import type { SessionPlan, SkeletonSession, SkeletonWeek } from '../src/types/plan.js';

const RULESET = loadRuleset();
const SEED = loadExercises();
const TODAY = '2026-10-19';

const CLEARANCE: ClearanceAnswers = {
  heartCondition: false,
  chestPain: false,
  dizziness: false,
  chronicCondition: false,
  prescriptionMedication: false,
  boneOrJointProblem: false,
  supervisedActivityOnly: false,
  isAdult: true,
};

function inventoryFor(weightRoom: boolean): Inventory {
  return {
    barbell: weightRoom,
    rack: weightRoom,
    plates: { smallestPairLb: 2.5 },
    trapBar: weightRoom,
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
    weightRoomAccess: weightRoom,
  };
}

function athleteFor(level: Level, weightRoom: boolean, pain: PainStatus[], sport: Sport = 'basketball'): Athlete {
  return {
    id: 'owner',
    primaryGoal: 'vertical_jump',
    sport,
    trainingAge: level === 'beginner' ? 'none' : level === 'intermediate' ? '1to3' : '4plus',
    level,
    daysPerWeek: 4,
    weekdays: [1, 2, 4, 6],
    isAdult: true,
    clearance: CLEARANCE,
    painStatus: pain,
    inventory: inventoryFor(weightRoom),
    bodyweightKg: 84,
    workingMaxes: [],
    inSeason: false,
    readinessPassedAt: '2026-08-01',
    standingReachMm: null,
    goalHeightMm: 914,
    targetDate: '2026-11-29',
    primaryInstrument: 'ovr_jump_regular',
    baselineHeightMm: 747,
    timezone: 'UTC',
    rolloverHour: 3,
    canonicalTestNote: '',
    sorenessHistory: [],
    extraEquipment: [],
  };
}

function weekFor(level: Level, overrides: Partial<SkeletonWeek> = {}): SkeletonWeek {
  const range = RULESET.constants.extensiveRange[level];
  return {
    w: 7,
    kind: 'load',
    blockType: 'power',
    k: 1,
    windowStart: '2026-10-19',
    windowEnd: '2026-10-25',
    sessions: [],
    notes: [],
    targets: {
      extensiveBottom: range.bottom,
      extensiveTop: range.top,
      highIntensityAllowance: 21,
      depthJumpReps: 8,
      startOffsetPct: {},
      mainLiftBySlot: { lower: 'back_squat', upper: 'barbell_bench_press', fullbody: 'back_squat' },
      accessoryRotationSlot: 0,
      ladderRungs: { depth_jump_height: 2, hurdle_hop_height: 2, box_jump_height: 2 },
      tendonMode: 'plyometric',
    },
    ...overrides,
  };
}

function sessionFor(dayType: DayType, isTestDay: boolean): SkeletonSession {
  return { dayIndex: 2, weekday: 4, date: '2026-10-22', dayType, isTestDay };
}

interface BuildOptions {
  level?: Level;
  weightRoom?: boolean;
  pain?: PainStatus[];
  dayType?: DayType;
  isTestDay?: boolean;
  sport?: Sport;
  week?: Partial<SkeletonWeek>;
  isFirstBlock?: boolean;
}

function build(options: BuildOptions = {}): SessionPlan {
  const level = options.level ?? 'advanced';
  const athlete = athleteFor(level, options.weightRoom ?? true, options.pain ?? [], options.sport ?? 'basketball');
  const painGate = evaluatePainGate(
    { clearance: CLEARANCE, painStatus: athlete.painStatus, isAdult: true, today: TODAY },
    RULESET,
  );
  const context: SelectContext = {
    athlete,
    ruleset: RULESET,
    exercises: SEED.exercises,
    ladders: SEED.ladders,
    week: weekFor(level, options.week ?? {}),
    session: sessionFor(options.dayType ?? 'power_speed', options.isTestDay ?? false),
    painGate,
    rotationHistory: {},
    jointHighStressLastWeek: { knee: 0, spine: 0, shoulder: 0 },
    prng: mulberry32(1234),
    isFirstBlock: options.isFirstBlock ?? false,
  };
  return selectSession(context);
}

function rows(plan: SessionPlan): { id: string; block: string }[] {
  return plan.blocks.flatMap((block) => block.exercises.map((row) => ({ id: row.exerciseId, block: block.name })));
}

function displayed(plan: SessionPlan): number {
  let count = 0;
  for (const block of plan.blocks) {
    if (block.name === 'warm_up' || block.name === 'cool_down') continue;
    if (block.exercises.length === 0) continue;
    count += block.grouped ? 1 : block.exercises.length;
  }
  return count;
}

const DAY_TYPES: DayType[] = [
  'full_body_strength',
  'lower_strength',
  'upper_strength',
  'upper_mobility',
  'power_speed',
  'power',
  'speed',
  'recovery_mobility',
];
const LEVELS: Level[] = ['beginner', 'intermediate', 'advanced'];
const PAIN_STATES: { label: string; pain: PainStatus[] }[] = [
  { label: 'no pain', pain: [] },
  {
    label: 'mild chronic knee',
    pain: [{
      location: 'knee', severityRaw: '1-2', severity: 'mild', duration: 'chronic', durationWeeks: 30,
      reportedAt: '2026-01-01', reassessDueAt: '2026-11-01',
    }],
  },
  {
    label: 'moderate achilles',
    pain: [{
      location: 'achilles_calf', severityRaw: '3-4', severity: 'moderate', duration: 'acute', durationWeeks: 3,
      reportedAt: '2026-10-01', reassessDueAt: '2026-10-15',
    }],
  },
];

describe('selectSession invariant grid', () => {
  for (const dayType of DAY_TYPES) {
    for (const level of LEVELS) {
      for (const weightRoom of [true, false]) {
        for (const state of PAIN_STATES) {
          const label = `${dayType} / ${level} / ${weightRoom ? 'gym' : 'home'} / ${state.label}`;

          it(`holds every invariant: ${label}`, () => {
            const plan = build({ dayType, level, weightRoom, pain: state.pain, isTestDay: dayType === 'power_speed' });
            const all = plan.blocks.flatMap((block) => block.exercises);

            // Warm-up is first and cool-down or recovery is last (R29, R33, R34).
            expect(plan.blocks[0]?.name).toBe('warm_up');
            const lastBlock = plan.blocks[plan.blocks.length - 1]?.name;
            expect(['cool_down', 'recovery']).toContain(lastBlock);

            // R44: at most two high-CNS exercises.
            const byId = new Map(SEED.exercises.map((exercise) => [exercise.id, exercise]));
            const highCns = all.filter((row) => byId.get(row.exerciseId)?.cnsCost === 'high');
            expect(highCns.length).toBeLessThanOrEqual(RULESET.constants.maxHighCnsPerSession);

            // R23 to R25: at most two high-stress exercises per joint.
            for (const joint of ['kneeStress', 'spineStress', 'shoulderStress'] as const) {
              const count = all.filter((row) => byId.get(row.exerciseId)?.[joint] === 'high').length;
              expect(count).toBeLessThanOrEqual(RULESET.constants.maxJointHighStressPerSession);
            }

            // R67: heavy strength lifts per session by level.
            const heavy = all.filter((row) => row.loadType === 'heavy_strength').length;
            expect(heavy).toBeLessThanOrEqual(RULESET.constants.heavyLiftsPerSession[level]);

            // Hard contact caps (R85, R52), which no Block 5 rule may raise.
            expect(plan.contacts.highIntensity).toBeLessThanOrEqual(CONTACT_CAPS.highIntensityPerSession);
            expect(plan.contacts.highAmplitude).toBeLessThanOrEqual(CONTACT_CAPS.highAmplitudePerSession);

            // At most 8 displayed rows.
            expect(displayed(plan)).toBeLessThanOrEqual(RULESET.constants.maxDisplayedExercises);

            // Every row carries at least one set and no load: Block 6 fills those.
            for (const row of all) {
              expect(row.sets.length).toBeGreaterThan(0);
              for (const set of row.sets) expect(set.loadPercent).toBeUndefined();
            }

            // R99: a tendon loading exercise on every training session.
            if (dayType !== 'recovery_mobility') {
              const tendon = all.some((row) => byId.get(row.exerciseId)?.tendonTarget !== undefined);
              expect(tendon).toBe(true);
            }
          });
        }
      }
    }
  }
});

describe('pairings and ordering', () => {
  it('pairs a push with a pull on the upper strength day', () => {
    const plan = build({ dayType: 'upper_strength' });
    const byId = new Map(SEED.exercises.map((exercise) => [exercise.id, exercise]));
    const all = plan.blocks.flatMap((block) => block.exercises);
    expect(all.some((row) => byId.get(row.exerciseId)?.isPush === true)).toBe(true);
    expect(all.some((row) => byId.get(row.exerciseId)?.isPull === true)).toBe(true);
  });

  it('pairs a bilateral squat with a unilateral leg exercise and a posterior chain accessory', () => {
    const plan = build({ dayType: 'lower_strength', week: { blockType: 'strength' } });
    const byId = new Map(SEED.exercises.map((exercise) => [exercise.id, exercise]));
    const all = plan.blocks.flatMap((block) => byId.get(block.exercises[0]?.exerciseId ?? '') ? block.exercises : block.exercises);
    const exercises = all.map((row) => byId.get(row.exerciseId)).filter((e) => e !== undefined);
    expect(exercises.some((e) => e.unilateral && ['squat', 'hinge', 'lunge'].includes(e.movementPattern))).toBe(true);
    expect(exercises.some((e) => e.rotationGroup === 'posterior_chain')).toBe(true);
  });

  it('follows a sagittal session with a frontal or transverse movement', () => {
    const plan = build({ dayType: 'lower_strength' });
    const byId = new Map(SEED.exercises.map((exercise) => [exercise.id, exercise]));
    const all = plan.blocks.flatMap((block) => block.exercises);
    expect(all.some((row) => byId.get(row.exerciseId)?.plane !== 'sagittal')).toBe(true);
  });

  it('places the test at the head of the Power day and marks it maximal CNS', () => {
    const plan = build({ dayType: 'power_speed', isTestDay: true });
    const names = plan.blocks.map((block) => block.name);
    expect(names.indexOf('jump_test')).toBeGreaterThan(names.indexOf('primer'));
    expect(names.indexOf('jump_test')).toBeLessThan(names.indexOf('power'));
    expect(plan.isMaximalCns).toBe(true);
    expect(plan.headerSuffixes).toContain('test day');
  });

  it('puts high-CNS work before low-CNS work inside a block', () => {
    const plan = build({ dayType: 'power_speed', isTestDay: true });
    const byId = new Map(SEED.exercises.map((exercise) => [exercise.id, exercise]));
    const power = plan.blocks.find((block) => block.name === 'power');
    const ranks = (power?.exercises ?? []).map((row) => {
      const cost = byId.get(row.exerciseId)?.cnsCost ?? 'low';
      return cost === 'high' ? 2 : cost === 'moderate' ? 1 : 0;
    });
    for (let index = 1; index < ranks.length; index += 1) {
      expect(ranks[index - 1] ?? 0).toBeGreaterThanOrEqual(ranks[index] ?? 0);
    }
  });
});

describe('contacts and budgets', () => {
  it('keeps the load-week Power day inside the level extensive range', () => {
    const plan = build({ level: 'advanced', dayType: 'power_speed', isTestDay: true });
    const range = RULESET.constants.extensiveRange.advanced;
    expect(plan.contacts.extensive).toBeGreaterThanOrEqual(range.bottom);
    expect(plan.contacts.extensive).toBeLessThanOrEqual(range.top);
  });

  it('counts a depth jump as two contacts a rep and holds ten reps', () => {
    const plan = build({ dayType: 'power_speed', isTestDay: true });
    const depth = plan.blocks
      .flatMap((block) => block.exercises)
      .find((row) => row.exerciseId === 'depth_jump');
    expect(depth).toBeDefined();
    expect(depth?.contactsPerRep).toBe(CONTACT_CAPS.depthJumpContactsPerRep);
    const reps = (depth?.sets ?? []).reduce((total, set) => total + (set.reps ?? 0), 0);
    expect(reps).toBeLessThanOrEqual(CONTACT_CAPS.depthJumpRepCap);
  });

  it('never schedules a depth jump in the Strength block, a deload or a first block', () => {
    const cases: BuildOptions[] = [
      { week: { blockType: 'strength' } },
      { week: { kind: 'deload' } },
      { isFirstBlock: true },
      { level: 'beginner' },
    ];
    for (const options of cases) {
      const plan = build({ dayType: 'power_speed', isTestDay: true, ...options });
      expect(rows(plan).some((row) => row.id === 'depth_jump')).toBe(false);
    }
  });

  it('keeps the Speed day free of high-intensity contacts', () => {
    const plan = build({ dayType: 'speed' });
    expect(plan.contacts.highIntensity).toBe(0);
  });

  it('counts change-of-direction cuts as extensive contacts', () => {
    const plan = build({ dayType: 'power_speed', isTestDay: true });
    const cod = plan.blocks.find((block) => block.name === 'cod');
    expect(cod?.exercises.length).toBeGreaterThan(0);
  });
});

describe('sport and day coverage', () => {
  it('gives basketball both a jump session and a change-of-direction session in the week', () => {
    const jumpDay = jumpDayTypeFor(4);
    const codDay = codDayTypeFor(4);
    const jumpPlan = build({ dayType: jumpDay, isTestDay: true, sport: 'basketball' });
    const codPlan = build({ dayType: codDay, isTestDay: true, sport: 'basketball' });
    const byId = new Map(SEED.exercises.map((exercise) => [exercise.id, exercise]));
    const hasJump = jumpPlan.blocks
      .flatMap((block) => block.exercises)
      .some((row) => byId.get(row.exerciseId)?.plyometric !== undefined);
    const hasCod = codPlan.blocks.some((block) => block.name === 'cod' && block.exercises.length > 0);
    expect(hasJump).toBe(true);
    expect(hasCod).toBe(true);
  });

  it('drops the change-of-direction block for a general athlete', () => {
    const plan = build({ dayType: 'power_speed', isTestDay: true, sport: 'none' });
    expect(plan.blocks.some((block) => block.name === 'cod')).toBe(false);
  });
});

describe('determinism', () => {
  it('returns the same session for the same seed', () => {
    const first = build({ dayType: 'lower_strength' });
    const second = build({ dayType: 'lower_strength' });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe("the brief's worked Power + Speed day", () => {
  const plan = build({ level: 'intermediate', dayType: 'power_speed', isTestDay: true });
  const named = (block: string): string[] =>
    plan.blocks.find((entry) => entry.name === block)?.exercises.map((row) => row.exerciseId) ?? [];
  const setsOf = (id: string): { sets: number; reps: number } => {
    const row = plan.blocks.flatMap((block) => block.exercises).find((entry) => entry.exerciseId === id);
    return { sets: row?.sets.length ?? 0, reps: row?.sets[0]?.reps ?? 0 };
  };

  it('runs the fixed primer, the test, three jumps, the COD block and one tendon accessory', () => {
    expect(plan.blocks.map((block) => block.name)).toEqual([
      'warm_up', 'primer', 'jump_test', 'power', 'cod', 'accessory', 'cool_down',
    ]);
    expect(named('primer')).toEqual(['pogo_hops', 'submax_cmj']);
    expect(named('jump_test')).toEqual(['weekly_jump_test']);
    expect(named('power')).toEqual(['depth_jump', 'box_jump', 'hurdle_hop']);
    expect(named('cod')).toEqual(['shuttle_5_10_5', 'cut_and_sprint_45']);
    expect(named('accessory')).toEqual(['single_leg_calf_isometric']);
  });

  it("matches the brief's set shapes and box heights", () => {
    expect(setsOf('pogo_hops')).toEqual({ sets: 2, reps: 5 });
    expect(setsOf('submax_cmj')).toEqual({ sets: 2, reps: 3 });
    expect(setsOf('weekly_jump_test')).toEqual({ sets: 1, reps: 5 });
    expect(setsOf('depth_jump')).toEqual({ sets: 4, reps: 2 });
    expect(setsOf('hurdle_hop')).toEqual({ sets: 4, reps: 5 });
    expect(setsOf('box_jump')).toEqual({ sets: 4, reps: 3 });
    const rows = plan.blocks.flatMap((block) => block.exercises);
    expect(rows.find((row) => row.exerciseId === 'depth_jump')?.boxHeightIn).toBe(18);
    expect(rows.find((row) => row.exerciseId === 'hurdle_hop')?.boxHeightIn).toBe(9);
    expect(rows.find((row) => row.exerciseId === 'box_jump')?.boxHeightIn).toBe(24);
  });

  it("matches the brief's totals: 21 of 25 high, 16 of 20 amplitude, 60 extensive, 8 rows", () => {
    expect(plan.contacts.highIntensity).toBe(21);
    expect(plan.contacts.highAmplitude).toBe(16);
    expect(plan.contacts.extensive).toBe(60);
    expect(plan.contacts.targetExtensive).toBe(60);
    expect(displayed(plan)).toBe(8);
  });

  it('rests maximal jumps and sprints at 180 s (R88, R104 under R164)', () => {
    const rows = plan.blocks.flatMap((block) => block.exercises);
    expect(rows.find((row) => row.exerciseId === 'depth_jump')?.restS).toBe(180);
    expect(rows.find((row) => row.exerciseId === 'shuttle_5_10_5')?.restS).toBe(180);
    expect(rows.find((row) => row.exerciseId === 'hurdle_hop')?.restS).toBe(120);
  });
});
