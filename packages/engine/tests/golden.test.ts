/**
 * The golden file: the brief's worked Power + Speed day, materialized through
 * the engine and asserted row for row, plus the worked per-set numbers that
 * share the same week.
 *
 * Level: brief section 09's worked numbers are all "intermediate, entered
 * back-squat 1RM 275 lb", and the day's own totals name "extensive 60 inside
 * 60 to 100", which is the intermediate range (R83). The owner fixture is
 * advanced and runs the same day at 80 to 120 contacts; both are asserted, the
 * worked one here and the owner's in `tests/fixtures.test.ts`.
 *
 * Week: Power block load week 2, k = 1, 4 days a week. For a program starting
 * Mon 7 Sep 2026 with a target of Sun 29 Nov 2026 that is W = 12 with the
 * Power block at weeks 6 to 10, so the worked week is week 7.
 *
 * Ladders: two rungs earned in the Strength block, which puts the depth jump
 * at 18 in, the hurdles at 9 in and the box at 24 in.
 */
import { describe, expect, it } from 'vitest';
import { PROGRAM_START, WEEKDAYS, baseAthlete, gridRuleset, gridSeed } from './grid.support.js';
import { materializeWeek } from '../src/materialize.js';
import { planSkeleton } from '../src/skeleton/index.js';
import { displayedRowCount } from '../src/select/order.js';
import { lbToKg } from '../src/units.js';
import type { Athlete } from '../src/types/athlete.js';
import type { MaterializeHistory, SessionExercise, SessionPlan, WeekPlan } from '../src/types/plan.js';

const ruleset = gridRuleset;
const { exercises, ladders } = gridSeed;
const byId = new Map(exercises.map((exercise) => [exercise.id, exercise]));

const WORKED_MAX_LB = 275;

function workedAthlete(): Athlete {
  const frozenAt = `${PROGRAM_START}T03:00:00.000Z`;
  return {
    ...baseAthlete(),
    level: 'intermediate',
    trainingAge: '1to3',
    daysPerWeek: 4,
    weekdays: WEEKDAYS[4],
    targetDate: '2026-11-29',
    workingMaxes: [
      {
        lift: 'back_squat',
        valueKg: lbToKg(WORKED_MAX_LB),
        source: 'entered',
        confidence: 1,
        frozenAt,
        failStreak: 0,
      },
      {
        lift: 'trap_bar_deadlift',
        valueKg: lbToKg(WORKED_MAX_LB),
        source: 'entered',
        confidence: 1,
        frozenAt,
        failStreak: 0,
      },
    ],
  };
}

/** Two rungs earned in the Strength block, none yet spent in the Power block. */
function workedHistory(): MaterializeHistory {
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

function workedWeek(w = 7, k = 1): WeekPlan {
  const athlete = workedAthlete();
  const skeleton = planSkeleton(athlete, PROGRAM_START, ruleset);
  const week = skeleton.weeks.find((entry) => entry.w === w);
  if (week === undefined) throw new RangeError(`no week ${w}`);
  const weeks = skeleton.weeks.map((entry) => (entry.w === w ? { ...entry, k } : entry));
  return materializeWeek({
    athlete,
    ruleset,
    exercises,
    ladders,
    skeleton: { ...skeleton, weeks },
    w,
    workingMaxes: athlete.workingMaxes,
    history: workedHistory(),
    today: week.windowStart,
    seed: 1,
  });
}

function session(week: WeekPlan, dayType: string): SessionPlan {
  const found = week.sessions.find((entry) => entry.dayType === dayType);
  if (found === undefined) throw new RangeError(`no ${dayType} session`);
  return found;
}

function row(plan: SessionPlan, exerciseId: string): SessionExercise {
  for (const block of plan.blocks) {
    for (const entry of block.exercises) {
      if (entry.exerciseId === exerciseId) return entry;
    }
  }
  throw new RangeError(`no ${exerciseId} row`);
}

function shape(entry: SessionExercise): string {
  return `${entry.sets.length} x ${entry.sets[0]?.reps ?? entry.sets[0]?.durationS ?? 0}`;
}

function displays(entry: SessionExercise): string[] {
  return entry.sets.map((set) => set.displayLoad);
}

describe('golden: the worked Power + Speed day (brief section 09)', () => {
  const week = workedWeek();
  const power = session(week, 'power_speed');

  it('is the Power block load week 2 of a 12-week program', () => {
    expect(week.w).toBe(7);
    expect(week.kind).toBe('load');
    expect(week.blockType).toBe('power');
    expect(week.snapshot.k).toBe(1);
    expect(week.snapshot.targets.highIntensityAllowance).toBe(21);
    expect(week.snapshot.targets.depthJumpReps).toBe(8);
  });

  it('runs the fixed primer at 16 extensive contacts', () => {
    expect(shape(row(power, 'pogo_hops'))).toBe('2 x 5');
    expect(shape(row(power, 'submax_cmj'))).toBe('2 x 3');
    const primer = power.blocks.find((block) => block.name === 'primer');
    expect(primer?.grouped).toBe(true);
    const contacts = (primer?.exercises ?? []).reduce(
      (sum, entry) =>
        sum +
        entry.sets.reduce((inner, set) => inner + (set.reps ?? 0), 0) *
          (byId.get(entry.exerciseId)?.plyometric?.contactsPerRep ?? 0),
      0,
    );
    expect(contacts).toBe(16);
  });

  it('puts the jump test first at 5 attempts, high-CNS number one', () => {
    const test = row(power, 'weekly_jump_test');
    expect(test.sets).toHaveLength(1);
    expect(test.sets[0]?.reps).toBe(5);
    expect(power.isTestDay).toBe(true);
    expect(power.testStatus).toBe('planned');
    expect(power.headerSuffixes).toContain('· Test day');
  });

  it('prescribes depth jump 18 in, 4 x 2, rest 180 s', () => {
    const depth = row(power, 'depth_jump');
    expect(shape(depth)).toBe('4 x 2');
    expect(depth.boxHeightIn).toBe(18);
    expect(depth.rung).toBe(2);
    expect(depth.restS).toBe(180);
    expect(depth.contactsPerRep).toBe(2);
    expect(depth.landingPromptOnLastSet).toBe(true);
  });

  it('prescribes hurdle hop 9 in 4 x 5 and box jump 24 in 4 x 3', () => {
    const hurdle = row(power, 'hurdle_hop');
    expect(shape(hurdle)).toBe('4 x 5');
    expect(hurdle.boxHeightIn).toBe(9);
    const box = row(power, 'box_jump');
    expect(shape(box)).toBe('4 x 3');
    expect(box.boxHeightIn).toBe(24);
  });

  it('runs the COD block: 5-10-5 x 4 and a 45-degree cut and sprint 4 x 15 m', () => {
    // D-19: the stored snapshot's shuttle rows moved from "1 x BW" to "1 rep"
    // with "2 cuts" on the second line, and the cut and sprint kept "15 m" and
    // gained "1 cut". Brief 09 counts this block in reps and cuts ("5-10-5
    // shuttle 4 reps (8 cuts) and 45-degree cut-and-sprint 4 x 15 m (4 cuts)"),
    // so the bodyweight notation was never this block's to borrow.
    const shuttle = row(power, 'shuttle_5_10_5');
    expect(shuttle.sets).toHaveLength(4);
    expect(shuttle.restS).toBe(180);
    expect(displays(shuttle)).toEqual(['1 rep', '1 rep', '1 rep', '1 rep']);
    expect(shuttle.sets.map((set) => set.detailLine)).toEqual([
      '2 cuts',
      '2 cuts',
      '2 cuts',
      '2 cuts',
    ]);
    const cut = row(power, 'cut_and_sprint_45');
    expect(cut.sets).toHaveLength(4);
    expect(displays(cut)).toEqual(['15 m', '15 m', '15 m', '15 m']);
    expect(cut.sets.map((set) => set.detailLine)).toEqual(['1 cut', '1 cut', '1 cut', '1 cut']);
    expect(cut.restS).toBe(180);
    const cod = power.blocks.find((block) => block.name === 'cod');
    expect(cod?.exercises.map((entry) => entry.exerciseId)).toEqual([
      'shuttle_5_10_5',
      'cut_and_sprint_45',
    ]);
  });

  it('carries the single-leg calf isometric at 3 x 30 s, one extra set for the depth-jump week', () => {
    const calf = row(power, 'single_leg_calf_isometric');
    expect(calf.sets).toHaveLength(3);
    expect(displays(calf)).toEqual(['30 s hold', '30 s hold', '30 s hold']);
    expect(calf.bothSides).toBe(true);
    expect(byId.get('single_leg_calf_isometric')?.defaultSets).toBe(2);
    expect(week.lines.join(' ')).toContain('(+1 set: depth-jump week)');
  });

  it('ends with a cool-down carrying hip mobility', () => {
    const coolDown = power.blocks.at(-1);
    expect(coolDown?.name).toBe('cool_down');
    expect(coolDown?.grouped).toBe(true);
    const groups = (coolDown?.exercises ?? []).map(
      (entry) => byId.get(entry.exerciseId)?.rotationGroup,
    );
    expect(groups).toContain('hip_mobility');
  });

  it('totals high-intensity 21 of 25, high-amplitude 16 of 20, extensive 60 at the R89 target', () => {
    expect(power.contacts.highIntensity).toBe(21);
    expect(power.contacts.capHigh).toBe(25);
    expect(power.contacts.highAmplitude).toBe(16);
    expect(power.contacts.capAmplitude).toBe(20);
    expect(power.contacts.extensive).toBe(60);
    expect(power.contacts.targetExtensive).toBe(60);
    const range = ruleset.constants.extensiveRange.intermediate;
    expect(power.contacts.extensive).toBeGreaterThanOrEqual(range.bottom);
    expect(power.contacts.extensive).toBeLessThanOrEqual(range.top);
  });

  it('shows exactly two high-CNS exercises and 8 displayed rows', () => {
    const highCns = power.blocks
      .filter((block) => block.name !== 'warm_up')
      .flatMap((block) => block.exercises)
      .filter((entry) => byId.get(entry.exerciseId)?.cnsCost === 'high')
      .map((entry) => entry.exerciseId);
    expect(highCns).toEqual(['weekly_jump_test', 'depth_jump']);
    expect(displayedRowCount(power.blocks)).toBe(8);
    expect(power.isMaximalCns).toBe(true);
  });

  it('orders the blocks warm-up, primer, test, power, COD, accessory, cool-down', () => {
    expect(power.blocks.map((block) => block.name)).toEqual([
      'warm_up',
      'primer',
      'jump_test',
      'power',
      'cod',
      'accessory',
      'cool_down',
    ]);
  });
});

describe('golden: the worked per-set numbers that share the week', () => {
  const week = workedWeek();
  const lower = session(week, 'lower_strength');

  it('Power block main lift (R109), 3 sets: 5 x 205, 4 x 220, 3 x 235', () => {
    const squat = row(lower, 'back_squat');
    expect(squat.sets.map((set) => set.loadPercent)).toEqual([75, 80, 85]);
    expect(displays(squat)).toEqual(['5 × 205 lb', '4 × 220 lb', '3 × 235 lb']);
    expect(squat.sourceLine).toBe('entered 275 lb');
    expect(squat.loadMode).toBe('entered');
  });

  it('the secondary trap bar is retagged strength speed: 5 x 165, 4 x 180, 3 x 195', () => {
    const trap = row(lower, 'trap_bar_deadlift');
    expect(trap.loadType).toBe('strength_speed');
    expect(trap.sets.map((set) => set.loadPercent)).toEqual([60, 65, 70]);
    expect(displays(trap)).toEqual(['5 × 165 lb', '4 × 180 lb', '3 × 195 lb']);
  });

  it('the deload back squat runs 2 sets at held loads', () => {
    const deload = workedWeek(5, 0);
    expect(deload.kind).toBe('deload');
    const squat = row(session(deload, 'lower_strength'), 'back_squat');
    expect(squat.sets).toHaveLength(2);
    expect(squat.sets.every((set) => set.reps === 3)).toBe(true);
    const reps = squat.sets.reduce((sum, set) => sum + (set.reps ?? 0), 0);
    expect(reps).toBe(6);
  });

  it('the peak session runs the main lift at 2 sets with a descending rep count', () => {
    const peak = workedWeek(12, 1);
    expect(peak.kind).toBe('peak');
    const peakSession = peak.sessions.find((entry) => !entry.isTestDay && entry.dayType !== 'recovery_mobility');
    expect(peakSession).toBeDefined();
    if (peakSession === undefined) return;
    const squat = row(peakSession, 'back_squat');
    expect(squat.sets).toHaveLength(2);
    expect(squat.sets.map((set) => set.reps)).toEqual([3, 2]);
    expect(displays(squat)).toEqual(['3 × 205 lb', '2 × 220 lb']);
  });
});

describe('golden: the whole week, snapshotted', () => {
  it('matches the stored WeekPlan', () => {
    expect(workedWeek()).toMatchSnapshot();
  });
});
