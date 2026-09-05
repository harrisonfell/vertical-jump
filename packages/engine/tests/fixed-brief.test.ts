/**
 * Adversarial lens: brief section 09 "Program engine" and the four safety
 * overrides, section 16 "Answered on confirmation" and "Defaults asserted",
 * every worked number, the layout table, the two contact budgets and their
 * conventions, the pain-gate sentences, the outcome-line copy and the notation
 * strings, asserted at exact values against the shipped engine.
 *
 * Nothing in src/ is changed by this file.
 */
import { describe, expect, it } from 'vitest';
import { PROGRAM_START, WEEKDAYS, baseAthlete } from './grid.support.js';
import { gridRuleset, gridSeed } from './grid.seed.js';
import { materializeWeek } from '../src/materialize.js';
import { planSkeleton } from '../src/skeleton/index.js';
import { layoutTextFor, layoutFor, chainFor } from '../src/skeleton/layout.js';
import { getPerSetPrescription } from '../src/prescribe/index.js';
import { epley, bestEpley, resolveWorkingMax } from '../src/prescribe/workingMax.js';
import { computeExtensiveTarget, CONTACT_CAPS, dropHeightCapIn } from '../src/budgets.js';
import { decideOutcome, outcomeLine } from '../src/adherence/index.js';
import { evaluatePainGate, severePainSentence, SELF_SCREEN_SENTENCE } from '../src/select/painGate.js';
import { indexById } from '../src/exercises/index.js';
import {
  TIMES,
  MINUS,
  formatBodyweightSet,
  formatDistance,
  formatHeightIn,
  formatContactMs,
  formatVelocity,
  formatVelocitySet,
  formatHold,
  formatRest,
  formatLoadedSet,
  kgToLb,
  lbToKg,
} from '../src/units.js';
import type { Athlete, WorkingMax } from '../src/types/athlete.js';
import type { Level, TrainingAge } from '../src/types/core.js';
import type { Adherence, SetLog } from '../src/types/logs.js';
import type {
  MaterializeHistory,
  SessionExercise,
  SessionPlan,
  SetPrescription,
  WeekContext,
  WeekPlan,
} from '../src/types/plan.js';

const ruleset = gridRuleset;
const { exercises, ladders } = gridSeed;
const byId = indexById(exercises);
const constants = ruleset.constants;

const LOADED = [
  'back_squat',
  'trap_bar_deadlift',
  'db_bench_press',
  'barbell_bench_press',
  'overhead_press',
  'front_squat',
  'romanian_deadlift',
];

function history(): MaterializeHistory {
  return {
    rotationHistory: {},
    ladderState: {
      depth_jump_height: { rung: 2, advancesThisBlock: 0 },
      hurdle_hop_height: { rung: 2, advancesThisBlock: 0 },
      box_jump_height: { rung: 2, advancesThisBlock: 0 },
    },
    jointHighStressLastWeek: { knee: 0, spine: 0, shoulder: 0 },
    consecutiveAdherence: [],
    testPlateau: false,
    liftPlateau: {},
    liftRaisedSinceBlockStart: {},
  };
}

function maxes(maxLb: number): WorkingMax[] {
  const frozenAt = `${PROGRAM_START}T03:00:00.000Z`;
  return LOADED.map((lift) => ({
    lift,
    valueKg: lbToKg(maxLb),
    source: 'entered' as const,
    confidence: 1,
    frozenAt,
    failStreak: 0,
  }));
}

function athleteOf(level: Level, maxLb = 275): Athlete {
  const trainingAge: TrainingAge =
    level === 'beginner' ? 'none' : level === 'intermediate' ? '1to3' : '4plus';
  return {
    ...baseAthlete(),
    level,
    trainingAge,
    daysPerWeek: 4,
    weekdays: WEEKDAYS[4],
    targetDate: '2026-11-29',
    workingMaxes: maxes(maxLb),
  };
}

function build(athlete: Athlete, w: number, k: number): WeekPlan {
  const skeleton = planSkeleton(athlete, PROGRAM_START, ruleset);
  const target = skeleton.weeks.find((entry) => entry.w === w);
  if (target === undefined) throw new RangeError(`no week ${w}`);
  const weeks = skeleton.weeks.map((entry) => (entry.w === w ? { ...entry, k } : entry));
  return materializeWeek({
    athlete,
    ruleset,
    exercises,
    ladders,
    skeleton: { ...skeleton, weeks },
    w,
    workingMaxes: athlete.workingMaxes,
    history: history(),
    today: target.windowStart,
    seed: 1,
  });
}

function rowIn(week: WeekPlan, exerciseId: string): SessionExercise | undefined {
  for (const session of week.sessions) {
    for (const block of session.blocks) {
      for (const row of block.exercises) if (row.exerciseId === exerciseId) return row;
    }
  }
  return undefined;
}

function topPercent(row: SessionExercise | undefined): number | undefined {
  if (row === undefined) return undefined;
  let top: number | undefined;
  for (const set of row.sets) {
    if (set.isRamp) continue;
    if (set.loadPercent === undefined) continue;
    if (top === undefined || set.loadPercent > top) top = set.loadPercent;
  }
  return top;
}

function logOf(
  exerciseId: string,
  index: number,
  reps: number,
  lb: number,
  rpe?: number,
): SetLog {
  const log: SetLog = {
    id: `${exerciseId}-${index}`,
    sessionId: 's1',
    exerciseId,
    setNumber: index + 1,
    repsDone: reps,
    loadKg: lbToKg(lb),
    completedAt: '2026-09-09T18:00:00.000Z',
    idempotencyKey: `${exerciseId}-k${index}`,
    loadSource: 'entered',
    plannedDate: '2026-09-09',
  };
  if (rpe !== undefined) log.rpe = rpe;
  return log;
}

/* ------------------------------------------------- 09 Blocks and layout */

describe('brief 09: the layout table, verbatim', () => {
  const rows: [number, string][] = [
    [2, 'Power 1 - Peak 2'],
    [3, 'Power 1-2 - Peak 3'],
    [4, 'Power 1-3 - Peak 4'],
    [5, 'Power 1-4 - Peak 5'],
    [6, 'Strength 1-3 - Power 4-5 - Peak 6'],
    [7, 'Strength 1-3 - Power 4-6 - Peak 7'],
    [8, 'Strength 1-3 - Power 4-7 - Peak 8'],
    [9, 'Strength 1-3 - Power 4-7 - Taper 8 - Peak 9'],
    [10, 'Strength 1-4 - Deload 5 - Power 6-8 - Taper 9 - Peak 10'],
    [11, 'Strength 1-4 - Deload 5 - Power 6-9 - Taper 10 - Peak 11'],
    [12, 'Strength 1-4 - Deload 5 - Power 6-10 - Taper 11 - Peak 12'],
    [13, 'Strength 1-5 - Deload 6 - Power 7-11 - Taper 12 - Peak 13'],
    [14, 'Strength 1-6 - Deload 7 - Power 8-12 - Taper 13 - Peak 14'],
    [15, 'Strength 1-6 - Deload 7 - Power 8-13 - Taper 14 - Peak 15'],
    [16, 'Strength 1-4 - Deload 5 - Strength 6-9 - Deload 10 - Power 11-14 - Taper 15 - Peak 16'],
  ];
  for (const [W, text] of rows) {
    it(`W ${W} reads "${text}"`, () => {
      expect(layoutTextFor(ruleset, W, 'advanced')).toBe(text);
      expect(layoutFor(ruleset, W, 'advanced')).toHaveLength(W);
    });
  }

  it('beginners always get a Strength block first at W of 4 or more', () => {
    for (const W of [4, 5, 6, 8, 12, 16]) {
      const weeks = layoutFor(ruleset, W, 'beginner');
      expect([W, weeks[0]?.blockType]).toEqual([W, 'strength']);
    }
  });

  it('over 16 chains 12-week programs from the last test', () => {
    expect(chainFor(ruleset, 20)).toEqual({ chained: true, programWeeks: 12, remainingWeeks: 8 });
    expect(chainFor(ruleset, 30)).toEqual({ chained: true, programWeeks: 12, remainingWeeks: 18 });
  });

  it('the 12-week default is Strength 1-4, Deload 5, Power 6-10, Taper 11, Peak 12 (brief 16)', () => {
    const weeks = layoutFor(ruleset, 12, 'advanced');
    expect(weeks.map((week) => `${week.blockType}/${week.kind}`)).toEqual([
      'strength/load',
      'strength/load',
      'strength/load',
      'strength/load',
      'strength/deload',
      'power/load',
      'power/load',
      'power/load',
      'power/load',
      'power/load',
      'power/taper',
      'power/peak',
    ]);
  });
});

/* ------------------------------------------------------ 09 level table */

describe('brief 09: every rule-book cap scales with level', () => {
  it('R154 top-set caps are 80, 87, 92 and display as 80, 85, 90', () => {
    expect(constants.levelTopSetCapPct).toEqual({ beginner: 80, intermediate: 87, advanced: 92 });
    expect(constants.levelTopSetCapDisplayPct).toEqual({
      beginner: 80,
      intermediate: 85,
      advanced: 90,
    });
  });

  it('R67 heavy lifts per session are 2, 2, 3', () => {
    expect(constants.heavyLiftsPerSession).toEqual({ beginner: 2, intermediate: 2, advanced: 3 });
  });

  it('R82 to R84 extensive ranges are 40-70, 60-100, 80-120', () => {
    expect(constants.extensiveRange.beginner).toEqual({ bottom: 40, top: 70 });
    expect(constants.extensiveRange.intermediate).toEqual({ bottom: 60, top: 100 });
    expect(constants.extensiveRange.advanced).toEqual({ bottom: 80, top: 120 });
  });

  it('R158 RPE caps are 8, 8.5, 9 and week 1 is 6, 6.5, 7 capped at 7', () => {
    expect(constants.rpeCap).toEqual({ beginner: 8, intermediate: 8.5, advanced: 9 });
    expect(constants.rpeLadder).toEqual([6, 7, 8]);
    expect(constants.week1RpeLadder).toEqual([6, 6.5, 7]);
    expect(constants.week1RpeCap).toBe(7);
  });

  it('the loaded-jump ceiling is bodyweight, 20%, 30% and depth jumps are never for beginners', () => {
    expect(constants.loadedJumpCeilingPct).toEqual({ beginner: 0, intermediate: 20, advanced: 30 });
    expect(constants.depthJumpEligible.beginner).toBe(false);
  });
});

/* ------------------------------------------- 09 Plyometrics: two budgets */

describe('brief 09: the two contact budgets and their conventions', () => {
  it('R85 25 high-intensity and R52 20 high-amplitude are the hard caps', () => {
    expect(CONTACT_CAPS.highIntensityPerSession).toBe(25);
    expect(CONTACT_CAPS.highAmplitudePerSession).toBe(20);
  });

  it('a depth jump is 2 contacts per rep, both high-intensity and high-amplitude', () => {
    const depth = byId.get('depth_jump');
    expect(depth?.plyometric?.contactsPerRep).toBe(2);
    expect(depth?.plyometric?.intensity).toBe('high');
    expect(depth?.plyometric?.amplitude).toBe('high');
    expect(CONTACT_CAPS.depthJumpContactsPerRep).toBe(2);
    expect(CONTACT_CAPS.depthJumpRepCap).toBe(10);
  });

  it('test attempts are high-intensity, not high-amplitude', () => {
    const test = byId.get('weekly_jump_test');
    expect(test?.plyometric?.intensity).toBe('high');
    expect(test?.plyometric?.amplitude).not.toBe('high');
    expect(constants.contactCaps.testAttemptContacts).toBe(5);
  });

  it('each change-of-direction cut is one extensive contact', () => {
    expect(byId.get('shuttle_5_10_5')?.codCutsPerRep).toBe(2);
    expect(byId.get('cut_and_sprint_45')?.codCutsPerRep).toBe(1);
  });

  it('primer pogos count as extensive; the warm-up carries none', () => {
    expect(byId.get('pogo_hops')?.plyometric?.category).toBe('extensive');
    const week = build(athleteOf('intermediate'), 7, 1);
    const power = week.sessions.find((entry) => entry.dayType === 'power_speed');
    const warmUp = power?.blocks.find((block) => block.name === 'warm_up');
    const counted = (warmUp?.exercises ?? []).filter(
      (row) => byId.get(row.exerciseId)?.plyometric !== undefined,
    );
    expect(counted).toEqual([]);
  });

  it('R89: E = clamp(bottom + 10k - 2H, bottom, top)', () => {
    expect(constants.r89).toEqual({ extensiveStepPerWeek: 10, highIntensityFactor: 2 });
    expect(computeExtensiveTarget(60, 100, 1, 21)).toBe(60);
    expect(computeExtensiveTarget(60, 100, 4, 5)).toBe(90);
    expect(computeExtensiveTarget(60, 100, 10, 0)).toBe(100);
    expect(computeExtensiveTarget(80, 120, 2, 17)).toBe(80);
  });

  it('the high-intensity schedule is 5 + depth reps 6, 8, 10, 10, 10 doubled', () => {
    expect(constants.highIntensitySchedule.powerLoadWeekDepthJumpReps).toEqual([6, 8, 10, 10, 10]);
    const H = constants.highIntensitySchedule.powerLoadWeekDepthJumpReps.map(
      (reps) => 5 + reps * 2,
    );
    expect(H).toEqual([17, 21, 25, 25, 25]);
    expect(constants.highIntensitySchedule.strengthLoadWeek).toEqual({
      testContacts: 5,
      maxFromIntensiveJumps: 10,
    });
    expect(constants.highIntensitySchedule.taperMaxWithinFourDays).toBe(10);
  });

  it('drop height is at most 24 in, 18 in over 220 lb or unknown', () => {
    expect(dropHeightCapIn(180)).toBe(24);
    expect(dropHeightCapIn(221)).toBe(18);
    expect(dropHeightCapIn(null)).toBe(18);
  });
});

/* ------------------------------------------------------- 09 worked numbers */

function prescribeOnce(
  exerciseId: string,
  athlete: Athlete,
  overrides: Partial<WeekContext>,
): SetPrescription[] {
  const exercise = byId.get(exerciseId);
  if (exercise === undefined) throw new RangeError(exerciseId);
  const workingMax = athlete.workingMaxes.find((entry) => entry.lift === exerciseId);
  const ctx: WeekContext = {
    w: 2,
    kind: 'load',
    blockType: 'strength',
    k: 1,
    targets: {
      extensiveBottom: 60,
      extensiveTop: 100,
      highIntensityAllowance: 5,
      depthJumpReps: 0,
      startOffsetPct: {},
      mainLiftBySlot: { lower: 'back_squat', upper: 'db_bench_press', fullbody: 'back_squat' },
      accessoryRotationSlot: 0,
      ladderRungs: {},
      tendonMode: 'plyometric',
    },
    isFirstProgramWeek1: false,
    isFirstPercentWeekForLift: false,
    sets: 3,
    ruleset,
    percentWeekIndexForLift: 5,
    ...overrides,
  };
  if (workingMax !== undefined && ctx.workingMax === undefined) ctx.workingMax = workingMax;
  if (ctx.squatWorkingMax === undefined) {
    const squat = athlete.workingMaxes.find((entry) => entry.lift === 'back_squat');
    if (squat !== undefined) ctx.squatWorkingMax = squat;
  }
  return getPerSetPrescription(exercise, athlete, ctx);
}

describe('brief 09: worked numbers (intermediate, entered back-squat 1RM 275 lb)', () => {
  const intermediate = athleteOf('intermediate');

  it('back squat, heavy strength, 4 sets, week 2 of a Strength block', () => {
    const sets = prescribeOnce('back_squat', intermediate, { sets: 4 });
    expect(sets.map((set) => set.displayLoad)).toEqual([
      '5 × 205 lb',
      '4 × 220 lb',
      '3 × 235 lb',
      '3 × 235 lb',
    ]);
    expect(sets.map((set) => set.loadPercent)).toEqual([75, 80, 85, 85]);
    expect(sets[3]?.isHeld).toBe(true);
    expect(sets.every((set) => set.restS === 180)).toBe(true);
    expect(formatRest(sets[0]?.restS ?? 0)).toBe('3:00');
  });

  it('beginner heavy strength, 3 sets: 5 @ 75, 4 @ 80, 3 @ 80 held at cap 80', () => {
    const sets = prescribeOnce('back_squat', athleteOf('beginner'), { sets: 3 });
    expect(sets.map((set) => set.loadPercent)).toEqual([75, 80, 80]);
    expect(sets.map((set) => set.reps)).toEqual([5, 4, 3]);
    expect(sets[2]?.isHeld).toBe(true);
  });

  it('advanced 7-set protocol: R1 60, R2 70 ramp, then 75, 80, 85, 90, 90 held at cap 92', () => {
    const sets = prescribeOnce('back_squat', athleteOf('advanced'), { sets: 7 });
    expect(sets.map((set) => set.loadPercent)).toEqual([60, 70, 75, 80, 85, 90, 90]);
    expect(sets.slice(0, 2).every((set) => set.isRamp)).toBe(true);
    expect(sets.map((set) => set.reps)).toEqual([5, 5, 5, 4, 3, 3, 3]);
    expect(sets[6]?.isHeld).toBe(true);
    expect(sets.every((set) => set.restS === 240)).toBe(true);
    expect(formatRest(240)).toBe('4:00');
  });

  it('the 7-set protocol numbers its sets 1 to 7 without repeating a set number', () => {
    const sets = prescribeOnce('back_squat', athleteOf('advanced'), { sets: 7 });
    expect(sets.map((set) => set.setNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('Power block main lift (R109) 3 sets and the retagged secondary', () => {
    const main = prescribeOnce('back_squat', intermediate, { sets: 3, blockType: 'power' });
    expect(main.map((set) => set.displayLoad)).toEqual(['5 × 205 lb', '4 × 220 lb', '3 × 235 lb']);
    const secondary = prescribeOnce('trap_bar_deadlift', intermediate, {
      sets: 3,
      blockType: 'power',
      loadTypeOverride: 'strength_speed',
    });
    expect(secondary.map((set) => set.loadPercent)).toEqual([60, 65, 70]);
    expect(secondary.map((set) => set.displayLoad)).toEqual([
      '5 × 165 lb',
      '4 × 180 lb',
      '3 × 195 lb',
    ]);
  });

  it('deload back squat, 2 sets: 3 × 220, 3 × 235 (6 of 15 reps, 40%)', () => {
    const sets = prescribeOnce('back_squat', intermediate, {
      sets: 2,
      kind: 'deload',
      reducedRepsCap: 3,
    });
    expect(sets.map((set) => set.displayLoad)).toEqual(['3 × 220 lb', '3 × 235 lb']);
    expect(sets.reduce((sum, set) => sum + (set.reps ?? 0), 0)).toBe(6);
  });

  it('peak session: 3 × 205, 2 × 220', () => {
    const sets = prescribeOnce('back_squat', intermediate, { sets: 2, kind: 'peak' });
    expect(sets.map((set) => set.displayLoad)).toEqual(['3 × 205 lb', '2 × 220 lb']);
  });

  it('loaded jump squat (advanced only): 3 × 3 × 80 lb, 9 high-intensity contacts', () => {
    const sets = prescribeOnce('trap_bar_jump', athleteOf('advanced'), { sets: 3 });
    expect(sets).toHaveLength(3);
    expect(sets.map((set) => set.displayLoad)).toEqual([
      '3 × 80 lb',
      '3 × 80 lb',
      '3 × 80 lb',
    ]);
    expect(sets.every((set) => set.loadPercent === 30)).toBe(true);
    const contacts =
      sets.reduce((sum, set) => sum + (set.reps ?? 0), 0) *
      (byId.get('trap_bar_jump')?.plyometric?.contactsPerRep ?? 1);
    expect(contacts).toBe(9);
  });

  it('an intermediate loaded jump is capped at 20% and a beginner gets bodyweight', () => {
    const inter = prescribeOnce('trap_bar_jump', athleteOf('intermediate'), { sets: 3 });
    expect(inter.every((set) => set.loadPercent === 20)).toBe(true);
    expect(inter[0]?.displayLoad).toBe('3 × 55 lb');
    const beginner = prescribeOnce('trap_bar_jump', athleteOf('beginner'), { sets: 3 });
    expect(beginner.every((set) => set.loadPercent === undefined)).toBe(true);
    expect(beginner[0]?.displayLoad).toBe(`3 ${TIMES} BW`);
  });

  it('a Spanish squat isometric holds 30 s and progresses to 35 s next week', () => {
    const now = prescribeOnce('spanish_squat_isometric', intermediate, {
      sets: 3,
      holdWeekIndex: 0,
    });
    expect(now.map((set) => set.displayLoad)).toEqual(['30 s hold', '30 s hold', '30 s hold']);
    const next = prescribeOnce('spanish_squat_isometric', intermediate, {
      sets: 3,
      holdWeekIndex: 1,
    });
    expect(next.map((set) => set.durationS)).toEqual([35, 35, 35]);
  });

  it('trap-bar deadlift, no max entered, first program: week 1, the 80% guard, then week 3', () => {
    const athlete: Athlete = { ...athleteOf('intermediate'), workingMaxes: [] };
    const week1 = prescribeOnce('trap_bar_deadlift', athlete, {
      sets: 3,
      isFirstProgramWeek1: true,
    });
    expect(week1.map((set) => set.displayLoad)).toEqual([
      '5 reps · RPE 6 · __ lb',
      '4 reps · RPE 6.5 · __ lb',
      '3 reps · RPE 7 · __ lb',
    ]);

    const trap = byId.get('trap_bar_deadlift');
    if (trap === undefined) throw new RangeError('trap_bar_deadlift');
    const logs = [logOf('trap_bar_deadlift', 0, 5, 225), logOf('trap_bar_deadlift', 1, 4, 245), logOf('trap_bar_deadlift', 2, 3, 265)];
    const best = bestEpley(logs, trap, ruleset, '2026-09-14T03:00:00.000Z');
    expect(best?.confidence).toBe(0.95);
    expect(Math.round(kgToLb(epley(lbToKg(265), 3)) * 10) / 10).toBe(291.5);
    const resolved = resolveWorkingMax(
      'trap_bar_deadlift',
      trap,
      undefined,
      null,
      logs,
      ruleset,
      '2026-09-14T03:00:00.000Z',
    );
    expect(Math.round(kgToLb(resolved.valueKg))).toBe(275);

    const guarded: Athlete = { ...athlete, workingMaxes: [resolved] };
    const week2 = prescribeOnce('trap_bar_deadlift', guarded, {
      sets: 3,
      workingMax: resolved,
      percentWeekIndexForLift: 0,
      isFirstPercentWeekForLift: true,
    });
    expect(week2.map((set) => set.displayLoad)).toEqual([
      '5 × 205 lb',
      '4 × 220 lb',
      '3 × 220 lb',
    ]);
    const week3 = prescribeOnce('trap_bar_deadlift', guarded, {
      sets: 3,
      workingMax: resolved,
      percentWeekIndexForLift: 1,
    });
    expect(week3.map((set) => set.displayLoad)).toEqual([
      '5 × 205 lb',
      '4 × 220 lb',
      '3 × 235 lb',
    ]);
  });

  it('DB bench, hypertrophy: Epley 76 x 0.95 = 72 -> working max 70, then 40 / 45 / 50', () => {
    const athlete: Athlete = { ...athleteOf('intermediate'), workingMaxes: [] };
    const bench = byId.get('db_bench_press');
    if (bench === undefined) throw new RangeError('db_bench_press');
    const logs = [logOf('db_bench_press', 0, 12, 50), logOf('db_bench_press', 1, 10, 55), logOf('db_bench_press', 2, 8, 60)];
    const resolved = resolveWorkingMax(
      'db_bench_press',
      bench,
      undefined,
      null,
      logs,
      ruleset,
      '2026-09-14T03:00:00.000Z',
    );
    expect(Math.round(kgToLb(resolved.valueKg))).toBe(70);
    const week2 = prescribeOnce(
      'db_bench_press',
      { ...athlete, workingMaxes: [resolved] },
      { sets: 3, workingMax: resolved, percentWeekIndexForLift: 5 },
    );
    expect(week2.map((set) => set.displayLoad)).toEqual([
      '12 × 40 lb',
      '10 × 45 lb',
      '8 × 50 lb',
    ]);
  });
});

/* ------------------------------------------- 09 the worked Power + Speed day */

describe('brief 09: the worked Power + Speed day totals', () => {
  const week = build(athleteOf('intermediate'), 7, 1);
  const power = week.sessions.find((entry) => entry.dayType === 'power_speed') as SessionPlan;

  it('totals 21 of 25 high-intensity, 16 of 20 high-amplitude, 60 extensive', () => {
    expect(power.contacts.highIntensity).toBe(21);
    expect(power.contacts.highAmplitude).toBe(16);
    expect(power.contacts.extensive).toBe(60);
    expect(power.contacts.targetExtensive).toBe(60);
  });

  it('rests maximal jumps, sprints and COD at 180 s and extensive drills at 120 s', () => {
    expect(rowIn(week, 'weekly_jump_test')?.restS).toBe(180);
    expect(rowIn(week, 'depth_jump')?.restS).toBe(180);
    expect(rowIn(week, 'shuttle_5_10_5')?.restS).toBe(180);
    expect(rowIn(week, 'cut_and_sprint_45')?.restS).toBe(180);
    for (const id of ['hurdle_hop', 'box_jump']) {
      expect([id, rowIn(week, id)?.restS]).toEqual([id, 120]);
    }
  });
});

/* ---------------------------------------------------- 09 safety overrides */

describe('brief 09: the four safety overrides', () => {
  it('ballistic never uses the power scheme and 30% is a hard ceiling', () => {
    expect(constants.schemes.ballistic.mode).toBe('straight');
    expect(constants.schemes.ballistic.stepPct).toBe(0);
    expect(byId.get('trap_bar_jump')?.ballisticCapPct).toBe(30);
    const sets = prescribeOnce('trap_bar_jump', athleteOf('advanced'), {
      sets: 3,
      targets: {
        extensiveBottom: 80,
        extensiveTop: 120,
        highIntensityAllowance: 5,
        depthJumpReps: 0,
        startOffsetPct: { ballistic: 40, heavy_strength: 20 },
        mainLiftBySlot: { lower: 'back_squat', upper: 'db_bench_press', fullbody: 'back_squat' },
        accessoryRotationSlot: 0,
        ladderRungs: {},
        tendonMode: 'plyometric',
      },
    });
    expect(sets.every((set) => (set.loadPercent ?? 0) <= 30)).toBe(true);
    expect(sets[0]?.displayLoad).toBe('3 × 80 lb');
  });

  it('med ball throws are not loadable', () => {
    for (const id of ['med_ball_scoop_toss', 'rotational_med_ball_throw']) {
      expect([id, byId.get(id)?.loadable]).toEqual([id, false]);
    }
  });

  it('Olympic lifts take the level caps and never an Epley estimate', () => {
    expect(constants.schemes.power.respectsLevelCap).toBe(true);
    const squat = byId.get('back_squat');
    if (squat === undefined) throw new RangeError('back_squat');
    const olympic = { ...squat, id: 'power_clean', isOlympicLift: true };
    const logs = [logOf('power_clean', 0, 3, 225)];
    expect(bestEpley(logs, olympic, ruleset, '2026-09-14T03:00:00.000Z')).toBeNull();
  });

  it('the working max is frozen, monotone, and rises at most 5% a week', () => {
    expect(constants.workingMax.epleyConfidence).toBe(0.95);
    expect(constants.workingMax.maxRaisePctPerWeek).toBe(5);
    expect(constants.workingMax.week2GuardPct).toBe(80);
    const squat = byId.get('back_squat');
    if (squat === undefined) throw new RangeError('back_squat');
    const previous: WorkingMax = {
      lift: 'back_squat',
      valueKg: lbToKg(275),
      source: 'entered',
      confidence: 1,
      frozenAt: '2026-09-07T03:00:00.000Z',
      lastRaiseAt: '2026-09-07T03:00:00.000Z',
      failStreak: 0,
    };
    const logs = [logOf('back_squat', 0, 5, 315, 9)];
    const next = resolveWorkingMax(
      'back_squat',
      squat,
      previous,
      null,
      logs,
      ruleset,
      '2026-09-14T03:00:00.000Z',
    );
    expect(Math.round(kgToLb(next.valueKg))).toBe(285);
  });

  it('R44 and R52 are hard caps Block 5 cannot raise', () => {
    for (const level of ['beginner', 'intermediate', 'advanced'] as Level[]) {
      const week = build(athleteOf(level), 9, 8);
      for (const session of week.sessions) {
        const at = `${level} ${session.dayType}`;
        expect([at, session.contacts.highIntensity <= 25]).toEqual([at, true]);
        expect([at, session.contacts.highAmplitude <= 20]).toEqual([at, true]);
        const highCns = session.blocks
          .filter((block) => block.name !== 'warm_up')
          .flatMap((block) => block.exercises)
          .filter((row) => byId.get(row.exerciseId)?.cnsCost === 'high').length;
        expect([at, highCns <= 2]).toEqual([at, true]);
      }
    }
  });

  it('no 1RM testing week: the shipped ruleset has no tested-week exemption', () => {
    expect(JSON.stringify(ruleset)).not.toMatch(/testedWeek|oneRmTest|tested_1rm/i);
  });
});

/* ------------------------------------------------------- 09 pain gate */

describe('brief 09 and 13: the pain gate sentences', () => {
  it('the severe knee sentence reads as brief 13 gives it', () => {
    expect(severePainSentence('knee')).toBe(
      'Medical clearance needed. You reported knee pain at 5+ (limits training). ' +
        'The rule book excludes all knee-stress lifts and all jumps at this level, ' +
        'including the weekly test. Get it assessed.',
    );
  });

  it('only the general self-screen blocks generation', () => {
    const base = baseAthlete();
    const severe = evaluatePainGate(
      {
        clearance: base.clearance,
        painStatus: [
          {
            location: 'knee',
            severityRaw: '5+',
            severity: 'severe',
            duration: 'acute',
            durationWeeks: 4,
            reportedAt: PROGRAM_START,
            reassessDueAt: '2026-09-21',
          },
        ],
        isAdult: true,
        today: PROGRAM_START,
      },
      ruleset,
    );
    expect(severe.blocksGeneration).toBe(false);
    expect(severe.clearanceScreen?.kind).toBe('severe_pain');

    const failed = evaluatePainGate(
      {
        clearance: { ...base.clearance, chestPain: true },
        painStatus: [],
        isAdult: true,
        today: PROGRAM_START,
      },
      ruleset,
    );
    expect(failed.blocksGeneration).toBe(true);
    expect(failed.clearanceScreen?.sentence).toBe(SELF_SCREEN_SENTENCE);
  });

  it('mild pain caps at 80% and moderate knee halves high-intensity contacts', () => {
    const base = baseAthlete();
    const mild = evaluatePainGate(
      {
        clearance: base.clearance,
        painStatus: [
          {
            location: 'knee',
            severityRaw: '1-2',
            severity: 'mild',
            duration: 'chronic',
            durationWeeks: 20,
            reportedAt: PROGRAM_START,
            reassessDueAt: '2026-09-21',
          },
        ],
        isAdult: true,
        today: PROGRAM_START,
      },
      ruleset,
    );
    expect(mild.caps.intensityPct).toBe(80);
    const moderate = evaluatePainGate(
      {
        clearance: base.clearance,
        painStatus: [
          {
            location: 'knee',
            severityRaw: '3-4',
            severity: 'moderate',
            duration: 'chronic',
            durationWeeks: 20,
            reportedAt: PROGRAM_START,
            reassessDueAt: '2026-09-21',
          },
        ],
        isAdult: true,
        today: PROGRAM_START,
      },
      ruleset,
    );
    expect(moderate.volumeCuts.highIntensityFactor).toBe(0.5);
  });
});

/* ---------------------------------------------------- 09 outcome line copy */

function adherenceOf(completed: number, prescribed: number, allReps: boolean): Adherence {
  return {
    prescribed,
    completed,
    pct: completed / prescribed,
    allRepsCompleted: allReps,
    perLiftFailures: allReps ? {} : ({ back_squat: true } as Record<string, boolean>),
  };
}

describe('brief 13: the outcome line copy', () => {
  it('progress line reads exactly as brief 13 gives it', () => {
    const adherence = adherenceOf(3, 3, true);
    const decision = decideOutcome(adherence, true, [], ruleset, { capMinusStartPct: 12 });
    expect(
      outcomeLine(7, adherence, decision, {
        liftLabel: 'squat',
        setNumber: 1,
        fromLb: 205,
        toLb: 220,
      }),
    ).toBe(
      'Week 7: 3 of 3 (100%), all reps made. Week 8 steps up: squat set 1 from 205 to 220 lb, contacts +10.',
    );
  });

  it('repeat line reads exactly as brief 13 gives it', () => {
    const adherence = adherenceOf(2, 3, true);
    const decision = decideOutcome(adherence, true, [], ruleset, {});
    expect(decision.kind).toBe('repeat');
    expect(
      outcomeLine(7, adherence, decision, {
        blockLabel: 'Power block',
        targetDateLabel: '29 Nov',
      }),
    ).toBe(
      'Week 7: 2 of 3 (67%). Week 8 repeats week 7: same loads, same sets. One load week comes off the Power block to keep 29 Nov.',
    );
  });

  it('hold line reads exactly as brief 13 gives it', () => {
    const adherence = adherenceOf(3, 3, false);
    const decision = decideOutcome(adherence, false, [], ruleset, {});
    expect(decision.kind).toBe('hold');
    expect(
      outcomeLine(7, adherence, decision, {
        liftName: 'back squat',
        liftLabel: 'squat',
        repsMissed: 2,
      }),
    ).toBe(
      `Week 7: 3 of 3, but 2 reps missed on back squat. Week 8: squat loads ${MINUS}5%, everything else held.`,
    );
  });

  it('the outcomes carry the brief’s magnitudes', () => {
    const small = decideOutcome(adherenceOf(3, 4, true), true, [], ruleset, {});
    expect(small.kind).toBe('small');
    expect(small.deltaExtensiveContacts).toBe(5);
    expect(small.deltaK).toBe(0.5);
    expect(small.deltaStartPct).toBe(0);
    const progress = decideOutcome(adherenceOf(4, 4, true), true, [], ruleset, {
      capMinusStartPct: 12,
    });
    expect(progress.deltaStartPct).toBe(5);
    expect(progress.deltaK).toBe(1);
    const capped = decideOutcome(adherenceOf(4, 4, true), true, [], ruleset, {
      capMinusStartPct: 7,
    });
    expect(capped.deltaStartPct).toBe(0);
    const twoHigh = decideOutcome(adherenceOf(4, 4, true), true, [1], ruleset, {
      capMinusStartPct: 12,
    });
    expect(twoHigh.deltaExtensiveContacts).toBe(15);
    const twoLow = decideOutcome(adherenceOf(1, 4, true), true, [0.5], ruleset, {});
    expect(twoLow.volumeCutPct).toBe(25);
  });

  it('at 3 days one miss is 67% and repeats the week', () => {
    expect(decideOutcome(adherenceOf(2, 3, true), true, [], ruleset, {}).kind).toBe('repeat');
  });
});

/* -------------------------------------------------------- notation strings */

describe('brief 09 and the contract: notation strings', () => {
  it('uses U+00D7 and U+2212, never x and never a hyphen', () => {
    expect(TIMES).toBe('×');
    expect(MINUS).toBe('−');
    expect(formatLoadedSet(5, 205)).toBe('5 × 205 lb');
    expect(formatBodyweightSet(8)).toBe('8 × BW');
    expect(formatBodyweightSet(8, 20)).toBe('8 × BW + 20 lb vest');
    expect(formatHold(30)).toBe('30 s hold');
    expect(formatDistance(15)).toBe('15 m');
    expect(formatVelocitySet(3, 3, 0.75, 1, 20)).toBe(
      '3 × 3 @ 0.75 to 1.00 m/s, stop at −20%',
    );
    expect(formatHeightIn(825.5)).toBe('32.5 in');
    expect(formatContactMs(0.212)).toBe('212 ms');
    expect(formatVelocity(0.82)).toBe('0.82 m/s');
    expect(formatRest(180)).toBe('3:00');
  });

  it('no engine string contains an em dash', () => {
    const strings: string[] = [];
    for (const level of ['beginner', 'intermediate', 'advanced'] as Level[]) {
      for (const w of [1, 2, 5, 7, 11, 12]) {
        const week = build(athleteOf(level), w, 1);
        strings.push(...week.lines);
        for (const session of week.sessions) {
          strings.push(...session.headerSuffixes);
          for (const block of session.blocks) {
            for (const row of block.exercises) {
              for (const set of row.sets) strings.push(set.displayLoad);
            }
          }
        }
      }
    }
    expect(strings.filter((text) => text.includes('—'))).toEqual([]);
  });
});

/* -------------------------------------------------- 09 reduced weeks hold loads */

describe('brief 09: a deload or taper holds loads, it never raises them', () => {
  function topOf(level: Level, w: number, k: number, id: string): number | undefined {
    return topPercent(rowIn(build(athleteOf(level), w, k), id));
  }

  it('the strength deload holds the prior load week’s main-lift top set', () => {
    for (const level of ['intermediate', 'advanced'] as Level[]) {
      const load = topOf(level, 4, 3, 'back_squat');
      const deload = topOf(level, 5, 3, 'back_squat');
      expect([level, `deload ${deload}`, `load ${load}`]).toEqual([
        level,
        `deload ${deload}`,
        `load ${load}`,
      ]);
      expect([level, (deload ?? 0) <= (load ?? 0)]).toEqual([level, true]);
    }
  });

  it('the taper holds the Power block’s main-lift top set', () => {
    for (const level of ['intermediate', 'advanced'] as Level[]) {
      const load = topOf(level, 10, 5, 'back_squat');
      const taper = topOf(level, 11, 5, 'back_squat');
      expect([level, `taper ${taper}`, `load ${load}`]).toEqual([
        level,
        `taper ${taper}`,
        `load ${load}`,
      ]);
      expect([level, (taper ?? 0) <= (load ?? 0)]).toEqual([level, true]);
    }
  });

  it('a hypertrophy lift is not raised into the 85 to 90% band by a deload', () => {
    for (const level of ['intermediate', 'advanced'] as Level[]) {
      const load = topOf(level, 4, 3, 'db_bench_press');
      const deload = topOf(level, 5, 3, 'db_bench_press');
      expect([level, `deload ${deload}`, `load ${load}`]).toEqual([
        level,
        `deload ${deload}`,
        `load ${load}`,
      ]);
      expect([level, (deload ?? 0) <= (load ?? 0)]).toEqual([level, true]);
    }
  });
});

/* ---------------------------------------------------- 09 week 1 and R92/R76 */

describe('brief 09: week 1 of a first program', () => {
  it('has exactly one maximal CNS session and holds the strength top set at 80%', () => {
    for (const level of ['beginner', 'intermediate', 'advanced'] as Level[]) {
      const week = build(athleteOf(level), 1, 0);
      const maximal = week.sessions.filter((session) => session.isMaximalCns);
      expect([level, maximal.length]).toEqual([level, 1]);
      expect([level, maximal[0]?.isTestDay]).toEqual([level, true]);
      const top = topPercent(rowIn(week, 'back_squat'));
      expect([level, `top ${top}`, top === undefined || top <= 80]).toEqual([
        level,
        `top ${top}`,
        true,
      ]);
    }
  });
});

/* ------------------------------------------------------ 16 defaults asserted */

describe('brief 16: defaults asserted', () => {
  it('the training week runs from the first chosen weekday to day 6', () => {
    const skeleton = planSkeleton(athleteOf('advanced'), PROGRAM_START, ruleset);
    expect(skeleton.weeks[0]?.windowStart).toBe('2026-09-07');
    expect(skeleton.weeks[0]?.windowEnd).toBe('2026-09-13');
  });

  it('the peak week contains the target date and lands the sessions at -5, -2, -1, 0', () => {
    const week = build(athleteOf('advanced'), 12, 1);
    expect(week.kind).toBe('peak');
    expect(week.sessions.map((session) => session.date)).toEqual([
      '2026-11-24',
      '2026-11-27',
      '2026-11-29',
    ]);
    expect(week.sessions.at(-1)?.isTestDay).toBe(true);
  });

  it('the PR threshold is 1.0 in per instrument, recalibrated after three sessions', () => {
    expect(constants.prThreshold).toEqual({
      defaultIn: 1,
      sessionsBeforeRecalibrate: 3,
      sdMultiplier: 2,
      roundUpToIn: 0.5,
    });
    expect(constants.noise).toEqual({ residualSdFloorIn: 0.6, testsBeforeUnfloored: 8 });
  });

  it('the back squat stays across the Strength to Power transition', () => {
    const skeleton = planSkeleton(athleteOf('advanced'), PROGRAM_START, ruleset);
    expect(skeleton.weeks.find((week) => week.w === 4)?.targets.mainLiftBySlot.lower).toBe(
      'back_squat',
    );
    expect(skeleton.weeks.find((week) => week.w === 7)?.targets.mainLiftBySlot.lower).toBe(
      'back_squat',
    );
  });

  it('the 4-day template is Lower, Upper, Power + Speed with the test, Recovery', () => {
    const week = build(athleteOf('advanced'), 7, 1);
    expect(week.sessions).toHaveLength(4);
    expect(week.sessions.map((session) => session.dayType)).toEqual([
      'lower_strength',
      'upper_strength',
      'power_speed',
      'recovery_mobility',
    ]);
    expect(week.sessions[2]?.isTestDay).toBe(true);
  });

  it('R99: a tendon loading exercise runs every week, deload, taper and peak included', () => {
    for (const w of [1, 2, 5, 7, 11, 12]) {
      const week = build(athleteOf('advanced'), w, 1);
      const tendon = week.sessions
        .flatMap((session) => session.blocks)
        .flatMap((block) => block.exercises)
        .filter((row) => byId.get(row.exerciseId)?.tendonTarget !== undefined);
      expect([w, tendon.length > 0]).toEqual([w, true]);
    }
  });

  it('soreness 7 or higher drops that day one tier: +2 reps, -10 points, no depth jumps', () => {
    expect(constants.soreness).toEqual({
      threshold: 7,
      repsAdd: 2,
      percentDrop: 10,
      highIntensityFactor: 0.5,
      noDepthJumps: true,
      deferTest: true,
    });
    const sets = prescribeOnce('back_squat', athleteOf('intermediate'), {
      sets: 3,
      sorenessToday: 8,
    });
    expect(sets.map((set) => set.reps)).toEqual([7, 6, 5]);
    expect(sets.map((set) => set.loadPercent)).toEqual([65, 70, 75]);
    expect(sets[0]?.original?.reps).toBe(5);
  });
});

/* --------------------------------------------- 09 R27 soreness, one tier down */

function buildSore(days: 2 | 3 | 4 | 5, w: number, k: number, soreness: number): WeekPlan {
  const athlete = { ...athleteOf('advanced'), daysPerWeek: days, weekdays: WEEKDAYS[days] };
  const skeleton = planSkeleton(athlete, PROGRAM_START, ruleset);
  const target = skeleton.weeks.find((entry) => entry.w === w);
  if (target === undefined) throw new RangeError(`no week ${w}`);
  const weeks = skeleton.weeks.map((entry) => (entry.w === w ? { ...entry, k } : entry));
  const plain = materializeWeek({
    athlete,
    ruleset,
    exercises,
    ladders,
    skeleton: { ...skeleton, weeks },
    w,
    workingMaxes: athlete.workingMaxes,
    history: history(),
    today: target.windowStart,
    seed: 1,
  });
  const testDate = plain.sessions.find((session) => session.isTestDay)?.date ?? target.windowStart;
  return materializeWeek({
    athlete,
    ruleset,
    exercises,
    ladders,
    skeleton: { ...skeleton, weeks },
    w,
    workingMaxes: athlete.workingMaxes,
    history: { ...history(), sorenessToday: soreness },
    today: testDate,
    seed: 1,
  });
}

describe('brief 09: R27 soreness drops the day one tier', () => {
  it('does not push extensive contacts above the level range top (R84)', () => {
    const sore = buildSore(4, 7, 1, 8);
    const range = constants.extensiveRange.advanced;
    for (const session of sore.sessions) {
      expect([session.dayType, session.contacts.extensive, `top ${range.top}`]).toEqual([
        session.dayType,
        Math.min(session.contacts.extensive, range.top),
        `top ${range.top}`,
      ]);
    }
  });

  it('halves the high-intensity contacts on the sore day', () => {
    const plain = build(athleteOf('advanced'), 7, 1);
    const plainHigh = plain.sessions.find((session) => session.isTestDay)?.contacts.highIntensity ?? 0;
    const sore = buildSore(4, 7, 1, 8);
    const soreDay = sore.sessions.find((session) => session.dayType === 'power_speed');
    expect(soreDay?.contacts.highIntensity ?? 0).toBeLessThanOrEqual(Math.ceil(plainHigh / 2));
  });

  it('never adds reps to the weekly jump test', () => {
    const sore = buildSore(2, 7, 1, 8);
    const test = rowIn(sore, 'weekly_jump_test');
    expect([`attempts ${test?.sets[0]?.reps}`]).toEqual(['attempts 5']);
  });
});

/* ---------------------------------------------- 09 the deferred test rides on */

describe('brief 09: a soreness-deferred test rides the next scheduled session', () => {
  it('generates a week at every day count instead of refusing', () => {
    for (const days of [2, 3, 4, 5] as const) {
      let message = 'ok';
      try {
        buildSore(days, 7, 1, 8);
      } catch (error) {
        message = `${(error as Error).name}: ${(error as Error).message}`;
      }
      expect([days, message]).toEqual([days, 'ok']);
    }
  });

  it('removes the test from the sore session, or does not mark it deferred', () => {
    for (const days of [2, 3, 4] as const) {
      const sore = buildSore(days, 7, 1, 8);
      for (const session of sore.sessions) {
        const carriesTest = session.blocks.some((block) => block.name === 'jump_test');
        expect([days, session.dayType, `deferred ${session.testStatus === 'deferred'}`, carriesTest]).toEqual([
          days,
          session.dayType,
          `deferred ${session.testStatus === 'deferred'}`,
          session.testStatus === 'deferred' ? false : carriesTest,
        ]);
      }
    }
  });

  it('recounts the receiving session so its contacts and maximal-CNS flag are true', () => {
    const sore = buildSore(4, 7, 1, 8);
    const receiver = sore.sessions.find(
      (session) => session.testStatus === 'planned' && session.isTestDay,
    );
    expect(receiver?.dayType).toBeDefined();
    expect([
      `high ${receiver?.contacts.highIntensity}`,
      `maximalCns ${receiver?.isMaximalCns}`,
    ]).toEqual(['high 5', 'maximalCns true']);
  });
});

/* ------------------------------------------------------------ week copy */

describe('brief 13: the week carries each notice once, in one wording', () => {
  it('in-season says one thing, once', () => {
    const inSeason: Athlete = { ...athleteOf('advanced'), inSeason: true };
    const week = build(inSeason, 7, 1);
    const lines = week.lines.filter((line) => /^in[- ]season/i.test(line));
    expect(lines).toEqual([
      'In-season: jump contacts halved, change of direction covered by games.',
    ]);
  });

  it('the deload notice is worded identically on the week and on the session', () => {
    const week = build(athleteOf('advanced'), 5, 3);
    const weekLine = week.lines.find((line) => line.startsWith('Deload week'));
    const sessionNotice = week.sessions[0]?.notices.find((line) => line.startsWith('Deload week'));
    expect(sessionNotice).toBe(weekLine);
  });
});
