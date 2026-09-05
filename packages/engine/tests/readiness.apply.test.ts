/**
 * Applying the readiness gate to a real materialized session
 * (house rule `house.sc.readiness_gate`).
 *
 * The sessions come from the owner fixture, which is built through the engine,
 * so these assertions run against the same rows the runner shows rather than
 * against a hand-made stub. Three properties are checked on every case:
 * downward only, today only, and idempotent.
 */
import { describe, expect, it } from 'vitest';

import { RULESET_V1 } from '../src/ruleset/index.js';
import { indexById, loadExercises } from '../src/exercises/index.js';
import { buildOwnerFixture } from '../src/fixtures/index.js';
import {
  READINESS_TRIM_REASON,
  applyReadinessAdjustment,
  scoreReadiness,
} from '../src/readiness/index.js';
import type { SessionPlan, SetPrescription, WeekPlan } from '../src/types/plan.js';
import type {
  ReadinessOutcome,
  ReadinessTestConfig,
  ReadinessTestSession,
} from '../src/types/readiness.js';

const CONFIG: ReadinessTestConfig = RULESET_V1.constants.climbing.readiness;
const { exercises } = loadExercises();
const byId = indexById(exercises);

const fixture = buildOwnerFixture();

/** The fixture's most recent materialized week, week 7 of the Power block. */
function latestWeek(): WeekPlan {
  const week = fixture.weeks[fixture.weeks.length - 1];
  if (week === undefined) throw new RangeError('the fixture built no weeks');
  return week;
}
const lastWeek = latestWeek();

function sessionOf(dayType: string): SessionPlan {
  const found = lastWeek.sessions.find((entry) => entry.dayType === dayType);
  if (found === undefined) throw new RangeError(`no ${dayType} session`);
  return found;
}

const BASELINE = [6.9, 7.0, 7.0, 7.1, 7.2, 7.3, 7.4];

function history(): ReadinessTestSession[] {
  return BASELINE.map((best, index) => ({
    id: `t${index}`,
    date: `2026-10-${String(index + 1).padStart(2, '0')}`,
    kind: 'seated_mb_throw' as const,
    attempts: [best],
    best,
    unit: 'm',
  }));
}

function outcomeFor(score: number, band: 'low' | 'moderate' | 'high', best: number): ReadinessOutcome {
  const today: ReadinessTestSession = {
    id: 'today',
    date: '2026-10-22',
    kind: 'seated_mb_throw',
    attempts: [best],
    best,
    unit: 'm',
  };
  return scoreReadiness(CONFIG, { date: '2026-10-22', score, band }, today, history(), RULESET_V1);
}

const BOTH_HIGH = outcomeFor(68, 'high', 7.2);
const AUTONOMIC_LOW = outcomeFor(41, 'low', 6.8);
const NEUROMUSCULAR_LOW = outcomeFor(68, 'high', 6.4);
const BOTH_LOW = outcomeFor(32, 'low', 6.4);

const OPTIONS = { exercisesById: byId };

/** Every set in a session, in order. */
function allSets(session: SessionPlan): SetPrescription[] {
  const out: SetPrescription[] = [];
  for (const block of session.blocks) for (const row of block.exercises) out.push(...row.sets);
  return out;
}

/**
 * The invariant that outranks everything else: intensity never goes up. Reps
 * may fall (a jump row scaled down) or rise by exactly the adjustment's rep
 * addition, which is the R27 magnitude and is always paid for with a lighter
 * load; loads and percentages only ever fall.
 */
function neverRaises(session: SessionPlan, outcome: ReadinessOutcome): void {
  const extraReps = outcome.adjustment.extraReps;
  for (const set of allSets(session)) {
    const original = set.original;
    if (original === undefined) continue;
    if (set.reps !== undefined && original.reps !== undefined && set.reps > original.reps) {
      expect(set.reps - original.reps).toBeLessThanOrEqual(extraReps);
      expect(set.loadKg ?? 0).toBeLessThanOrEqual(original.loadKg ?? 0);
    }
    if (set.loadKg !== undefined && original.loadKg !== undefined) {
      expect(set.loadKg).toBeLessThanOrEqual(original.loadKg);
    }
    if (set.loadPercent !== undefined && original.loadPercent !== undefined) {
      expect(set.loadPercent).toBeLessThanOrEqual(original.loadPercent);
    }
    expect(original.original).toBeUndefined();
  }
}

describe('both channels high', () => {
  it('leaves every row exactly where it was and only records the reading', () => {
    const before = sessionOf('power_speed');
    const after = applyReadinessAdjustment(before, BOTH_HIGH, OPTIONS);
    expect(after).not.toBe(before);
    expect(after.blocks).toEqual(before.blocks);
    expect(after.trimmed).toEqual(before.trimmed);
    expect(after.contacts).toEqual(before.contacts);
    expect(after.testStatus).toBe(before.testStatus);
    expect(after.readiness?.state).toBe('both_high');
    expect(after.notices.at(-1)).toBe(BOTH_HIGH.line);
    neverRaises(after, BOTH_HIGH);
  });

  it('does not mutate the session it was handed', () => {
    const before = sessionOf('lower_strength');
    const snapshot = JSON.stringify(before);
    applyReadinessAdjustment(before, BOTH_LOW, OPTIONS);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('the autonomic channel alone low', () => {
  it('changes no prescription: the volume hold binds the generator, not the day', () => {
    const before = sessionOf('power_speed');
    const after = applyReadinessAdjustment(before, AUTONOMIC_LOW, OPTIONS);
    expect(after.blocks).toEqual(before.blocks);
    expect(after.readiness?.adjustment.holdVolume).toBe(true);
    expect(after.notices.at(-1)).toContain('volume held');
    neverRaises(after, AUTONOMIC_LOW);
  });
});

describe('the neuromuscular channel alone low', () => {
  const before = sessionOf('power_speed');
  const after = applyReadinessAdjustment(before, NEUROMUSCULAR_LOW, OPTIONS);

  it('removes every maximal jump and says why', () => {
    const ids = after.blocks.flatMap((block) => block.exercises.map((row) => row.exerciseId));
    expect(ids).not.toContain('depth_jump');
    expect(ids).not.toContain('weekly_jump_test');
    expect(ids).toContain('hurdle_hop');
    expect(after.trimmed.map((entry) => entry.exerciseId)).toContain('depth_jump');
    for (const entry of after.trimmed.filter((row) => row.exerciseId === 'depth_jump')) {
      expect(entry.reason).toBe(READINESS_TRIM_REASON);
    }
  });

  it('defers the weekly test rather than losing it', () => {
    expect(before.testStatus).toBe('planned');
    expect(after.testStatus).toBe('deferred');
  });

  it('takes a quarter off the remaining jump volume and keeps the original row', () => {
    const hurdle = after.blocks
      .flatMap((block) => block.exercises)
      .find((row) => row.exerciseId === 'hurdle_hop');
    expect(hurdle).toBeDefined();
    for (const set of hurdle?.sets ?? []) {
      expect(set.original?.reps).toBe(8);
      expect(set.reps).toBe(6);
      expect(set.displayLoad).toBe('6 × BW');
    }
  });

  it('holds the loads: no barbell row moves on this state', () => {
    const strength = applyReadinessAdjustment(sessionOf('lower_strength'), NEUROMUSCULAR_LOW, OPTIONS);
    const squat = strength.blocks
      .flatMap((block) => block.exercises)
      .find((row) => row.exerciseId === 'back_squat');
    expect(squat?.sets.map((set) => set.displayLoad)).toEqual([
      '5 × 215 lb',
      '4 × 230 lb',
      '3 × 245 lb',
    ]);
    neverRaises(strength, NEUROMUSCULAR_LOW);
  });

  it('rebuilds the contact counts from what is left', () => {
    expect(before.contacts.highIntensity).toBeGreaterThan(0);
    expect(after.contacts.highIntensity).toBe(0);
    expect(after.contacts.highAmplitude).toBe(0);
    expect(after.contacts.extensive).toBeLessThan(before.contacts.extensive);
    expect(after.contacts.targetExtensive).toBe(before.contacts.targetExtensive);
    neverRaises(after, NEUROMUSCULAR_LOW);
  });
});

describe('both channels low', () => {
  it('takes the R27 magnitude on rep rows that are not contact budgeted', () => {
    const after = applyReadinessAdjustment(sessionOf('lower_strength'), BOTH_LOW, OPTIONS);
    const squat = after.blocks
      .flatMap((block) => block.exercises)
      .find((row) => row.exerciseId === 'back_squat');
    expect(squat?.sets.map((set) => set.displayLoad)).toEqual([
      '7 × 195 lb',
      '6 × 205 lb',
      '5 × 220 lb',
    ]);
    expect(squat?.sets[0]?.original?.displayLoad).toBe('5 × 215 lb');
    neverRaises(after, BOTH_LOW);
  });

  it('leaves holds and distances alone: a 30 s hold has no tier to drop', () => {
    const after = applyReadinessAdjustment(sessionOf('lower_strength'), BOTH_LOW, OPTIONS);
    const hold = after.blocks
      .flatMap((block) => block.exercises)
      .find((row) => row.exerciseId === 'single_leg_calf_isometric');
    expect(hold?.sets.every((set) => set.original === undefined)).toBe(true);
    expect(hold?.sets.map((set) => set.displayLoad)).toEqual(['40 s hold', '40 s hold']);
  });

  it('halves the jump volume rather than adding reps to it', () => {
    const after = applyReadinessAdjustment(sessionOf('power_speed'), BOTH_LOW, OPTIONS);
    const box = after.blocks
      .flatMap((block) => block.exercises)
      .find((row) => row.exerciseId === 'box_jump');
    expect(box?.sets.every((set) => set.reps === 3)).toBe(true);
    expect(box?.sets[0]?.original?.reps).toBe(6);
    neverRaises(after, BOTH_LOW);
  });
});

describe('idempotence', () => {
  it('applying twice equals applying once, on every state', () => {
    for (const outcome of [BOTH_HIGH, AUTONOMIC_LOW, NEUROMUSCULAR_LOW, BOTH_LOW]) {
      for (const dayType of ['lower_strength', 'upper_strength', 'power_speed']) {
        const once = applyReadinessAdjustment(sessionOf(dayType), outcome, OPTIONS);
        const twice = applyReadinessAdjustment(once, outcome, OPTIONS);
        expect(twice, `${outcome.state} on ${dayType}`).toEqual(once);
        expect(twice.notices.filter((line) => line === outcome.line).length).toBeLessThanOrEqual(1);
        neverRaises(twice, outcome);
      }
    }
  });
});

describe('without the exercise index', () => {
  it('reduces what it can name from the session and removes nothing', () => {
    const before = sessionOf('power_speed');
    const after = applyReadinessAdjustment(before, BOTH_LOW);
    const ids = after.blocks.flatMap((block) => block.exercises.map((row) => row.exerciseId));
    expect(ids).toContain('depth_jump');
    expect(after.trimmed).toEqual(before.trimmed);
    expect(after.contacts).toBe(before.contacts);
    const box = after.blocks
      .flatMap((block) => block.exercises)
      .find((row) => row.exerciseId === 'box_jump');
    expect(box?.sets.every((set) => set.reps === 3)).toBe(true);
    neverRaises(after, BOTH_LOW);
  });
});
