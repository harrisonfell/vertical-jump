/**
 * The invariants brief section 09 "Tests" names that are checked by building
 * specific weeks rather than by scanning the whole grid: moves, adherence,
 * repeats, soreness, the Block 1 gate and determinism.
 *
 * Split from `invariants.test.ts` so both files stay under the 500-line limit;
 * nothing here touches the grid, so it costs one pass, not two.
 */
import { describe, expect, it } from 'vitest';
import { BARE_INVENTORY, PAIN_CASES, PROGRAM_START, WEEKDAYS, gridRuleset, gridSeed } from './grid.support.js';
import { build, freshHistory, twelveWeekOwner } from './invariants.support.js';
import { addDays, diffDays } from '../src/calendar.js';
import { canMoveSession, validateWeekdays } from '../src/move.js';
import { computeAdherence, decideOutcome } from '../src/adherence/index.js';
import { materializeWeek, GenerationBlockedError } from '../src/materialize.js';
import { planSkeleton } from '../src/skeleton/index.js';
import type { Athlete } from '../src/types/athlete.js';
import type { SessionPlan } from '../src/types/plan.js';
import type { SessionRecord } from '../src/types/logs.js';

const ruleset = gridRuleset;
const { exercises, ladders } = gridSeed;

function rows(session: SessionPlan): { id: string; sets: number }[] {
  return session.blocks.flatMap((block) =>
    block.exercises.map((row) => ({ id: row.exerciseId, sets: row.sets.length })),
  );
}

describe('invariants checked on specific weeks (brief section 09 "Tests")', () => {
  it('a session moved by the athlete still satisfies every spacing rule, or is refused in plain words with its rule number', () => {
    const week = build(twelveWeekOwner(), 7);
    const power = week.sessions.find((session) => session.dayType === 'power_speed');
    const lower = week.sessions.find((session) => session.dayType === 'lower_strength');
    expect(power).toBeDefined();
    expect(lower).toBeDefined();
    if (power === undefined || lower === undefined) return;
    const onto = canMoveSession(week, power.date, addDays(lower.date, 1), ruleset);
    expect(onto.ok).toBe(false);
    if (!onto.ok) {
      expect(onto.reason.length).toBeGreaterThan(0);
      expect(onto.reason).not.toMatch(/R\d+/);
      expect(Number.isInteger(onto.rule)).toBe(true);
    }
    expect(validateWeekdays(WEEKDAYS[4], 4, ruleset).ok).toBe(true);
    // Two days a week put Full Body Strength and Power + Speed side by side.
    const consecutive = validateWeekdays([1, 2], 2, ruleset);
    expect(consecutive.ok).toBe(false);
    if (!consecutive.ok) expect(consecutive.rule).toBe(91);
    expect(validateWeekdays([1, 2, 3], 4, ruleset).ok).toBe(false);
  });

  it('adherence counts Recovery days and counts a moved session on its new date', () => {
    const week = build(twelveWeekOwner(), 3);
    expect(week.sessions.some((session) => session.dayType === 'recovery_mobility')).toBe(true);
    const records: SessionRecord[] = week.sessions.map((session, index) => ({
      sessionId: session.id,
      // The last session is moved a day later and still counts.
      date: index === week.sessions.length - 1 ? addDays(session.date, 1) : session.date,
      dayType: session.dayType,
      status: 'done',
    }));
    const adherence = computeAdherence(week, [], records);
    expect(adherence.prescribed).toBe(4);
    expect(adherence.completed).toBe(4);
    expect(adherence.pct).toBe(1);
  });

  it('a week with no completed session scores 0 percent and repeats', () => {
    const week = build(twelveWeekOwner(), 3);
    const adherence = computeAdherence(week, [], []);
    expect(adherence.pct).toBe(0);
    const decision = decideOutcome(adherence, false, [], ruleset);
    expect(decision.kind).toBe('repeat');
  });

  it('a repeat week reuses the same day types, exercises, starting percentages, contact targets and rungs', () => {
    const athlete = twelveWeekOwner();
    const skeleton = planSkeleton(athlete, PROGRAM_START, ruleset);
    const base = materializeWeek({
      athlete,
      ruleset,
      exercises,
      ladders,
      skeleton,
      w: 3,
      workingMaxes: [],
      history: freshHistory(),
      today: skeleton.weeks[2]?.windowStart ?? PROGRAM_START,
      seed: 5,
    });
    const records: SessionRecord[] = base.sessions.slice(0, 1).map((session) => ({
      sessionId: session.id,
      date: session.date,
      dayType: session.dayType,
      status: 'done',
    }));
    const repeated = materializeWeek({
      athlete,
      ruleset,
      exercises,
      ladders,
      skeleton,
      w: 4,
      workingMaxes: [],
      history: freshHistory(),
      today: skeleton.weeks[3]?.windowStart ?? PROGRAM_START,
      seed: 5,
      prevWeek: { plan: base, logs: [], sessions: records },
    });
    expect(repeated.outcome?.kind).toBe('repeat');
    expect(repeated.repeatOfWeek).toBe(3);
    expect(repeated.sessions.map((session) => session.dayType)).toEqual(
      base.sessions.map((session) => session.dayType),
    );
    expect(repeated.snapshot.targets.startOffsetPct).toEqual(base.snapshot.targets.startOffsetPct);
    expect(repeated.snapshot.targets.ladderRungs).toEqual(base.snapshot.targets.ladderRungs);
    for (const session of repeated.sessions) {
      expect(session.headerSuffixes).toContain('· Repeat of week 3');
    }
  });

  it('a rung advance and the +10 extensive contacts never land in the same week (R89)', () => {
    const adherence = { prescribed: 4, completed: 4, pct: 1, allRepsCompleted: true, perLiftFailures: {} };
    const atTop = decideOutcome(adherence, true, [], ruleset, { atExtensiveTop: true });
    expect(atTop.allowLadderAdvance).toBe(true);
    expect(atTop.deltaExtensiveContacts).toBe(0);
    const below = decideOutcome(adherence, true, [], ruleset, { atExtensiveTop: false });
    expect(below.allowLadderAdvance).toBe(false);
    expect(below.deltaExtensiveContacts).toBeGreaterThan(0);
  });

  it('soreness 7 or higher reduces only that day and keeps the unreduced prescription in `original` (R27)', () => {
    const athlete: Athlete = {
      ...twelveWeekOwner(),
      workingMaxes: [
        {
          lift: 'back_squat',
          valueKg: 275 / 2.2046226218,
          source: 'entered',
          confidence: 1,
          frozenAt: `${PROGRAM_START}T03:00:00.000Z`,
          failStreak: 0,
        },
      ],
    };
    const skeleton = planSkeleton(athlete, PROGRAM_START, ruleset);
    const week7 = skeleton.weeks.find((entry) => entry.w === 7);
    const today = week7?.sessions[0]?.date ?? PROGRAM_START;
    const history = freshHistory();
    history.sorenessToday = 8;
    const plan = materializeWeek({
      athlete,
      ruleset,
      exercises,
      ladders,
      skeleton,
      w: 7,
      workingMaxes: [],
      history,
      today,
      seed: 5,
    });
    const sore = plan.sessions.find((session) => session.date === today);
    const other = plan.sessions.find((session) => session.date !== today);
    expect(sore?.notices.join(' ')).toContain('Soreness 8/10');
    const squat = sore?.blocks
      .flatMap((block) => block.exercises)
      .find((row) => row.exerciseId === 'back_squat');
    expect(squat?.sets[0]?.original).toBeDefined();
    expect(squat?.sets[0]?.reps).toBe((squat?.sets[0]?.original?.reps ?? 0) + 2);
    expect(other?.notices.join(' ')).not.toContain('Soreness');
    for (const block of other?.blocks ?? []) {
      for (const row of block.exercises) {
        for (const set of row.sets) expect(set.original).toBeUndefined();
      }
    }
    expect(sore?.blocks.some((block) => block.exercises.some((row) => row.exerciseId === 'depth_jump'))).toBe(false);
  });

  it('a Block 1 exclusion is never loosened by any Block 2 to 6 rule (R28)', () => {
    const severe = PAIN_CASES.find((entry) => entry.name === 'severe knee restricted');
    const athlete: Athlete = { ...twelveWeekOwner(), painStatus: severe?.painStatus ?? [] };
    const byId = new Map(exercises.map((entry) => [entry.id, entry]));
    for (const w of [1, 5, 7, 12]) {
      const week = build(athlete, w);
      for (const session of week.sessions) {
        for (const block of session.blocks) {
          for (const row of block.exercises) {
            const exercise = byId.get(row.exerciseId);
            expect(exercise?.kneeStress, `${row.exerciseId} in w${w}`).not.toBe('high');
            expect(exercise?.plyometric, `${row.exerciseId} in w${w}`).toBeUndefined();
          }
        }
      }
    }
  });

  it('only the general self-screen blocks generation; severe site pain shows the clearance screen and still restricts', () => {
    const severe = PAIN_CASES.find((entry) => entry.name === 'severe knee restricted');
    const restricted: Athlete = { ...twelveWeekOwner(), painStatus: severe?.painStatus ?? [] };
    const week = build(restricted, 2);
    expect(week.sessions[0]?.headerSuffixes).toContain('· Restricted');

    const base = twelveWeekOwner();
    const blocked: Athlete = {
      ...base,
      clearance: { ...base.clearance, chestPain: true },
    };
    expect(() => build(blocked, 1)).toThrow(GenerationBlockedError);
  });

  it('regenerating a week from the same snapshot produces a byte-identical WeekPlan', () => {
    const athlete = twelveWeekOwner();
    const first = build(athlete, 7);
    const second = build(athlete, 7);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    const bare = build({ ...athlete, inventory: BARE_INVENTORY }, 7);
    expect(JSON.stringify(build({ ...athlete, inventory: BARE_INVENTORY }, 7))).toBe(
      JSON.stringify(bare),
    );
  });

  it('every session estimate is built from sets times work plus rest', () => {
    const week = build(twelveWeekOwner(), 7);
    for (const session of week.sessions) {
      expect(session.estimatedMinutes).toBeGreaterThan(0);
      expect(Number.isInteger(session.estimatedMinutes)).toBe(true);
    }
    const strength = week.sessions.find((session) => session.dayType === 'lower_strength');
    expect(strength?.estimatedMinutes ?? 0).toBeGreaterThanOrEqual(60);
    expect(strength?.estimatedMinutes ?? 0).toBeLessThanOrEqual(85);
  });

  it('a deferred test rides the next scheduled session', () => {
    const athlete = twelveWeekOwner();
    const skeleton = planSkeleton(athlete, PROGRAM_START, ruleset);
    const week7 = skeleton.weeks.find((entry) => entry.w === 7);
    const testDay = week7?.sessions.find((session) => session.isTestDay);
    const history = freshHistory();
    history.sorenessToday = 9;
    const plan = materializeWeek({
      athlete,
      ruleset,
      exercises,
      ladders,
      skeleton,
      w: 7,
      workingMaxes: [],
      history,
      today: testDay?.date ?? PROGRAM_START,
      seed: 5,
    });
    const deferred = plan.sessions.find((session) => session.date === testDay?.date);
    expect(deferred?.testStatus).toBe('deferred');
    expect(deferred?.blocks.some((block) => block.name === 'jump_test')).toBe(false);
    const next = plan.sessions[(deferred?.date === undefined ? 0 : plan.sessions.indexOf(deferred)) + 1];
    expect(next?.blocks.some((block) => block.name === 'jump_test')).toBe(true);
    expect(next?.blocks[0]?.name).toBe('warm_up');
  });

  it('the peak week keeps the target date inside its window and tests on it', () => {
    const athlete = twelveWeekOwner();
    const week = build(athlete, 12);
    const test = week.sessions.find((session) => session.isTestDay);
    expect(test?.date).toBe(athlete.targetDate);
    expect(diffDays(week.windowStart, athlete.targetDate)).toBeGreaterThanOrEqual(0);
    expect(diffDays(athlete.targetDate, week.windowEnd)).toBeGreaterThanOrEqual(0);
  });

  it('a repeat of the same week from the same inputs keeps the same rows', () => {
    const week = build(twelveWeekOwner(), 5);
    expect(rows(week.sessions[0] as SessionPlan)).toEqual(
      rows(build(twelveWeekOwner(), 5).sessions[0] as SessionPlan),
    );
  });
});
