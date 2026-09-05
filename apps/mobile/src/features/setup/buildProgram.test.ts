import { describe, expect, it } from 'vitest';
import { inToMm, lbToKg } from '@vert/engine';
import type { Athlete } from '@/data';
import { buildProgramPlan, seedFor } from './buildProgram';
import { toEngineAthlete } from './engineAthlete';

/**
 * The build runs the real generator, so this is the test that says the setup
 * answers actually reach the engine in a shape it accepts. The owner's own
 * answers are used: advanced, four days, 29.4 in to 36.0 in by 29 Nov.
 */

const TODAY = '2026-09-04';

const CLEAR = {
  heartCondition: false,
  chestPain: false,
  dizziness: false,
  chronicCondition: false,
  prescriptionMedication: false,
  boneOrJointProblem: false,
  supervisedActivityOnly: false,
  isAdult: true,
  attestedAt: TODAY,
};

const INVENTORY = {
  barbell: true,
  rack: true,
  plates: { smallestPairLb: 5 },
  trapBar: true,
  dumbbells: { maxLb: 100, incrementLb: 5 },
  kettlebells: false,
  boxHeightsIn: [12, 18, 24, 30],
  hurdleHeightsIn: [6, 9, 12],
  bands: true,
  medBall: true,
  vestLb: 20,
  bench: true,
  pullupBar: true,
  cable: false,
  sled: false,
};

function owner(patch: Partial<Athlete> = {}): Athlete {
  return {
    id: 'athlete_owner',
    primaryGoal: 'vertical_jump',
    sport: 'basketball',
    trainingAgeYears: 5,
    level: 'advanced',
    daysPerWeek: 4,
    weekdays: [1, 2, 4, 6],
    isAdult: true,
    clearance: CLEAR,
    inventory: INVENTORY,
    weightRoomAccess: true,
    bodyweightKg: lbToKg(181),
    workingMax: {
      back_squat: {
        exerciseId: 'back_squat',
        valueKg: lbToKg(275),
        source: 'entered',
        confidence: 1,
        frozenAt: `${TODAY}T03:00:00.000Z`,
        lastRaiseAt: null,
      },
    },
    inSeason: false,
    readinessPassedAt: '2026-09-01',
    standingReachMm: null,
    goalHeightMm: inToMm(36),
    targetDate: '2026-11-29',
    timezone: 'America/New_York',
    rolloverHour: 3,
    testConditionsNote: null,
    createdAt: `${TODAY}T00:00:00.000Z`,
    updatedAt: `${TODAY}T00:00:00.000Z`,
    ...patch,
  };
}

const BASELINE = { heightMm: inToMm(29.4), instrument: 'ovr_jump_regular' as const };

function build(patch: Partial<Athlete> = {}) {
  return buildProgramPlan({
    athlete: owner(patch),
    pains: [],
    baseline: BASELINE,
    today: TODAY,
    generatedAt: `${TODAY}T12:00:00.000Z`,
  });
}

describe('buildProgramPlan', () => {
  it('builds a 12-week program that starts on the first chosen weekday', () => {
    const plan = build();
    expect(plan.skeleton.programStart).toBe('2026-09-07');
    expect(plan.skeleton.W).toBe(12);
    expect(plan.skeleton.daysPerWeek).toBe(4);
    expect(plan.skeleton.weeks).toHaveLength(12);
  });

  it('materialises week 1 with a session on every chosen weekday', () => {
    const plan = build();
    expect(plan.week1.w).toBe(1);
    expect(plan.week1.sessions).toHaveLength(4);
    expect(plan.week1.sessions.map((session) => session.date)).toEqual([
      '2026-09-07',
      '2026-09-08',
      '2026-09-10',
      '2026-09-12',
    ]);
    for (const session of plan.week1.sessions) {
      expect(session.blocks.length).toBeGreaterThan(0);
    }
  });

  it('puts the weekly test on the third weekday pick', () => {
    const plan = build();
    const test = plan.week1.sessions.filter((session) => session.isTestDay);
    expect(test).toHaveLength(1);
    expect(test[0]?.date).toBe('2026-09-10');
  });

  it('writes the exact "Program built" line', () => {
    expect(build().builtLine).toBe(
      'Program built: 12 weeks, 4 days a week. Week 1 starts Mon 7 Sep, first jump test Thu 10 Sep,' +
        ' peak week ends Sun 29 Nov. Week 1 is moderate effort (RPE 6-7) on lifts without a max;' +
        ' loads are prescribed from week 2.',
    );
  });

  it('is deterministic: the same answers build the same seed and the same week', () => {
    const a = build();
    const b = build();
    expect(a.seed).toBe(b.seed);
    expect(JSON.stringify(a.week1)).toBe(JSON.stringify(b.week1));
  });

  it('seeds from the answers that shape the program, not from a clock', () => {
    const athlete = toEngineAthlete({ athlete: owner(), pains: [], baseline: BASELINE });
    expect(seedFor(athlete, '2026-09-07')).toBe(seedFor(athlete, '2026-09-07'));
    expect(seedFor(athlete, '2026-09-07')).not.toBe(seedFor(athlete, '2026-09-14'));
  });

  it('refuses a profile that has no training days', () => {
    expect(() => build({ daysPerWeek: null })).toThrow('Pick how many days a week you train.');
  });

  it('blocks generation when the self-screen failed', () => {
    expect(() => build({ clearance: { ...CLEAR, chestPain: true } })).toThrow(
      /No program is built until a clinician clears you/,
    );
  });
});
