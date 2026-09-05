/**
 * Adherence, the outcome it produces, and the exact lines the Plan shows
 * (brief section 13 "Key copy").
 */
import { describe, expect, it } from 'vitest';

import { RULESET_V1 } from '../src/ruleset/index.js';
import {
  RE_ENTRY_DAYS,
  adherenceLadderLine,
  computeAdherence,
  decideOutcome,
  needsReEntry,
  outcomeLine,
  reEntryPlan,
} from '../src/adherence/index.js';
import { MINUS } from '../src/units.js';
import type { Adherence, SessionRecord, SetLog } from '../src/types/logs.js';
import type { SessionPlan, SetPrescription } from '../src/types/plan.js';
import { buildSession, buildWeekPlan } from './skeleton.support.js';

function adherence(overrides: Partial<Adherence> = {}): Adherence {
  return {
    prescribed: 3,
    completed: 3,
    pct: 1,
    allRepsCompleted: true,
    perLiftFailures: {},
    ...overrides,
  };
}

function set(setNumber: number, reps: number, isRamp = false): SetPrescription {
  return {
    setNumber,
    reps,
    displayLoad: `${reps}`,
    restS: 180,
    restRule: 'main lift, 4 to 5 sets',
    isRamp,
    isHeld: false,
  };
}

function withSets(session: SessionPlan, exerciseId: string, sets: SetPrescription[]): SessionPlan {
  return {
    ...session,
    blocks: [
      {
        name: 'main_lift',
        grouped: false,
        exercises: [
          {
            exerciseId,
            name: exerciseId,
            block: 'main_lift',
            role: 'main_lift',
            loadType: 'heavy_strength',
            loadMode: 'entered',
            bothSides: false,
            sets,
            restS: 180,
            restRule: 'main lift, 4 to 5 sets',
            sourceLine: 'entered 275 lb',
            landingPromptOnLastSet: false,
            contactsPerRep: 0,
            cues: [],
          },
        ],
      },
    ],
  };
}

function record(sessionId: string, date: string, done: boolean): SessionRecord {
  return {
    sessionId,
    date,
    dayType: 'lower_strength',
    status: done ? 'done' : 'missed',
    markedCompleteAt: done ? `${date}T18:00:00.000Z` : undefined,
  };
}

function log(sessionId: string, exerciseId: string, setNumber: number, repsDone: number): SetLog {
  return {
    id: `${sessionId}-${setNumber}`,
    sessionId,
    exerciseId,
    setNumber,
    repsDone,
    loadSource: 'entered',
    completedAt: '2026-10-19T18:00:00.000Z',
    plannedDate: '2026-10-19',
    idempotencyKey: `${sessionId}-${exerciseId}-${setNumber}`,
  };
}

describe('computeAdherence', () => {
  it('counts 3 of 4 as 75 percent, Recovery included', () => {
    const week = buildWeekPlan([
      buildSession('s1', '2026-10-19', 'lower_strength'),
      buildSession('s2', '2026-10-20', 'upper_strength'),
      buildSession('s3', '2026-10-22', 'power_speed'),
      buildSession('s4', '2026-10-24', 'recovery_mobility'),
    ]);
    const result = computeAdherence(
      week,
      [],
      [
        record('s1', '2026-10-19', true),
        record('s2', '2026-10-20', true),
        record('s3', '2026-10-22', true),
        record('s4', '2026-10-24', false),
      ],
    );
    expect(result.prescribed).toBe(4);
    expect(result.completed).toBe(3);
    expect(result.pct).toBeCloseTo(0.75, 5);
  });

  it('counts 2 of 3 as 67 percent and a moved session on its new date', () => {
    const week = buildWeekPlan([
      buildSession('s1', '2026-10-19', 'full_body_strength'),
      buildSession('s2', '2026-10-21', 'upper_mobility'),
      buildSession('s3', '2026-10-23', 'power_speed'),
    ]);
    const result = computeAdherence(week, [], [
      record('s1', '2026-10-20', true),
      record('s3', '2026-10-23', true),
    ]);
    expect(result.completed).toBe(2);
    expect(Math.round(result.pct * 100)).toBe(67);
  });

  it('scores a week with no completed session at 0', () => {
    const week = buildWeekPlan([buildSession('s1', '2026-10-19', 'lower_strength')]);
    const result = computeAdherence(week, [], [record('s1', '2026-10-19', false)]);
    expect(result.pct).toBe(0);
    expect(result.allRepsCompleted).toBe(false);
  });

  it('ignores a completed session dated outside the week window', () => {
    const week = buildWeekPlan([buildSession('s1', '2026-10-19', 'lower_strength')]);
    const result = computeAdherence(week, [], [record('s1', '2026-10-26', true)]);
    expect(result.completed).toBe(0);
  });

  it('judges a short logged set as a per-lift failure and ignores ramp sets', () => {
    const session = withSets(buildSession('s1', '2026-10-19', 'lower_strength'), 'back_squat', [
      set(1, 5, true),
      set(2, 5),
      set(3, 4),
    ]);
    const week = buildWeekPlan([session]);
    const result = computeAdherence(
      week,
      [log('s1', 'back_squat', 2, 5), log('s1', 'back_squat', 3, 2)],
      [record('s1', '2026-10-19', true)],
    );
    expect(result.allRepsCompleted).toBe(false);
    expect(result.perLiftFailures.back_squat).toBe(true);
  });

  it('treats an unperformed set in a finished session as not all reps, not a failure', () => {
    const session = withSets(buildSession('s1', '2026-10-19', 'lower_strength'), 'back_squat', [
      set(1, 5),
      set(2, 4),
    ]);
    const week = buildWeekPlan([session]);
    const result = computeAdherence(
      week,
      [log('s1', 'back_squat', 1, 5)],
      [record('s1', '2026-10-19', true)],
    );
    expect(result.allRepsCompleted).toBe(false);
    expect(result.perLiftFailures).toEqual({});
  });

  it('passes a fully logged session', () => {
    const session = withSets(buildSession('s1', '2026-10-19', 'lower_strength'), 'back_squat', [
      set(1, 5),
      set(2, 4),
    ]);
    const week = buildWeekPlan([session]);
    const result = computeAdherence(
      week,
      [log('s1', 'back_squat', 1, 5), log('s1', 'back_squat', 2, 4)],
      [record('s1', '2026-10-19', true)],
    );
    expect(result.allRepsCompleted).toBe(true);
  });
});

describe('decideOutcome', () => {
  it('repeats under 75 percent (R94)', () => {
    const result = decideOutcome(adherence({ prescribed: 3, completed: 2, pct: 2 / 3 }), true, [], RULESET_V1);
    expect(result.kind).toBe('repeat');
    expect(result.deltaK).toBe(0);
    expect(result.deltaExtensiveContacts).toBe(0);
    expect(result.volumeCutPct).toBe(0);
  });

  it('cuts 25 percent more after two weeks under 75 (R131 house)', () => {
    const result = decideOutcome(
      adherence({ prescribed: 3, completed: 1, pct: 1 / 3 }),
      true,
      [0.5],
      RULESET_V1,
    );
    expect(result.volumeCutPct).toBe(25);
  });

  it('adds volume only at 75 to 89 with all reps (R95)', () => {
    const result = decideOutcome(adherence({ prescribed: 4, completed: 3, pct: 0.75 }), true, [], RULESET_V1);
    expect(result.kind).toBe('small');
    expect(result.deltaK).toBe(0.5);
    expect(result.deltaExtensiveContacts).toBe(5);
    expect(result.deltaStartPct).toBe(0);
  });

  it('progresses at 90 or more with all reps (R96)', () => {
    const result = decideOutcome(adherence(), true, [], RULESET_V1, { capMinusStartPct: 12 });
    expect(result.kind).toBe('progress');
    expect(result.deltaK).toBe(1);
    expect(result.deltaStartPct).toBe(5);
    expect(result.deltaExtensiveContacts).toBe(10);
    expect(result.allowLadderAdvance).toBe(false);
  });

  it('sends the raise through the working max once the cap is within 10 points', () => {
    const result = decideOutcome(adherence(), true, [], RULESET_V1, { capMinusStartPct: 7 });
    expect(result.deltaStartPct).toBe(0);
  });

  it('never lands a rung advance and the +10 in the same week (R89)', () => {
    const result = decideOutcome(adherence(), true, [], RULESET_V1, { atExtensiveTop: true });
    expect(result.deltaExtensiveContacts).toBe(0);
    expect(result.allowLadderAdvance).toBe(true);
  });

  it('adds 5 more after two consecutive weeks at 90 or more (R130 house)', () => {
    const result = decideOutcome(adherence(), true, [0.95], RULESET_V1);
    expect(result.deltaExtensiveContacts).toBe(15);
  });

  it('holds and drops the failing lift 5 percent, 10 on a second failure (R97)', () => {
    const failing = adherence({ allRepsCompleted: false, perLiftFailures: { back_squat: true } });
    const first = decideOutcome(failing, false, [], RULESET_V1);
    expect(first.kind).toBe('hold');
    expect(first.deltaK).toBe(0);
    expect(first.deltaStartPct).toBe(0);
    expect(first.workingMaxDeltaPct.back_squat).toBe(-5);
    const second = decideOutcome(failing, false, [], RULESET_V1, { failStreaks: { back_squat: 1 } });
    expect(second.workingMaxDeltaPct.back_squat).toBe(-10);
  });
});

describe('outcome lines', () => {
  it('writes the progress line exactly', () => {
    const week = adherence();
    const decision = decideOutcome(week, true, [], RULESET_V1, { capMinusStartPct: 12 });
    expect(
      outcomeLine(7, week, decision, { liftLabel: 'squat', setNumber: 1, fromLb: 205, toLb: 220 }),
    ).toBe(
      'Week 7: 3 of 3 (100%), all reps made. Week 8 steps up: squat set 1 from 205 to 220 lb, contacts +10.',
    );
  });

  it('writes the repeat line exactly', () => {
    const week = adherence({ prescribed: 3, completed: 2, pct: 2 / 3 });
    const decision = decideOutcome(week, true, [], RULESET_V1);
    expect(outcomeLine(7, week, decision, { blockLabel: 'Power block', targetDateLabel: '29 Nov' })).toBe(
      'Week 7: 2 of 3 (67%). Week 8 repeats week 7: same loads, same sets. One load week comes off the Power block to keep 29 Nov.',
    );
  });

  it('writes the hold line exactly, with a real minus sign', () => {
    const week = adherence({ allRepsCompleted: false, perLiftFailures: { back_squat: true } });
    const decision = decideOutcome(week, false, [], RULESET_V1);
    const line = outcomeLine(7, week, decision, {
      liftName: 'back squat',
      liftLabel: 'squat',
      repsMissed: 2,
    });
    expect(line).toBe(
      `Week 7: 3 of 3, but 2 reps missed on back squat. Week 8: squat loads ${MINUS}5%, everything else held.`,
    );
    expect(line).toContain('−');
    expect(line).not.toContain('—');
  });

  it('writes the small line as volume only', () => {
    const week = adherence({ prescribed: 4, completed: 3, pct: 0.75 });
    const decision = decideOutcome(week, true, [], RULESET_V1);
    expect(outcomeLine(7, week, decision)).toBe(
      'Week 7: 3 of 4 (75%), all reps made. Week 8 adds volume only: contacts +5.',
    );
  });

  it('writes the live adherence ladder', () => {
    expect(adherenceLadderLine(7, adherence({ prescribed: 3, completed: 2, pct: 2 / 3 }))).toBe(
      'Week 7 · 2 of 3 done (67%) · finish 1 more for 100%',
    );
    expect(adherenceLadderLine(7, adherence())).toBe('Week 7 · 3 of 3 done (100%)');
  });
});

describe('re-entry after a break', () => {
  it('fires at 14 days with maxes -10 percent and contacts -25 percent', () => {
    expect(RE_ENTRY_DAYS).toBe(14);
    expect(needsReEntry(13)).toBe(false);
    expect(needsReEntry(14)).toBe(true);
    const plan = reEntryPlan(20);
    expect(plan).toEqual({
      required: true,
      workingMaxDeltaPct: -10,
      contactsCutPct: 25,
      repeatLastLoadWeek: true,
      line: 'Normal after a break.',
    });
  });
});
