import { describe, expect, it } from 'vitest';
import { buildClimberFixture, buildOwnerFixture, FIXTURE_TODAY } from '@vert/engine/fixtures';
import type { OwnerFixture } from '@vert/engine/fixtures';
import type { Json, Program, SessionWithStatus, Week } from '@/data/types';
import { fromEngineDayType } from './engine';
import { buildPlanModel } from './model';
import type { PlanState } from './states';

/**
 * The Plan model against the real generator output: twelve skeleton weeks,
 * seven of them built, week 7 half done on the test day.
 */

const owner = buildOwnerFixture();

function storeWeeks(fixture: OwnerFixture = owner): Week[] {
  return fixture.weeks.map((week) => ({
    id: `week-${week.w}`,
    programId: 'p1',
    programVersionId: 'v1',
    blockId: null,
    w: week.w,
    windowStart: week.windowStart,
    windowEnd: week.windowEnd,
    kind: week.kind,
    k: week.snapshot.k,
    prescribedCount: week.sessions.length,
    completedCount: 0,
    adherencePct: null,
    allRepsCompleted: null,
    outcome: week.outcome?.kind ?? null,
    generatedAt: week.snapshot.generatedAt,
    generatedBy: 'engine',
    repeatOfWeek: week.repeatOfWeek ?? null,
    jointHighStressCounts: null,
    highContactAllowance: null,
    extensiveTarget: null,
    ladderRungs: null,
    snapshot: week as unknown as Json,
  }));
}

function storeSessions(today: string, fixture: OwnerFixture = owner): SessionWithStatus[] {
  const done = new Set(
    fixture.sessions.filter((record) => record.status === 'done').map((record) => record.sessionId),
  );

  return fixture.weeks.flatMap((week) =>
    week.sessions.map((session, index) => {
      const finished = done.has(session.id);
      const status = finished ? 'done' : session.date < today ? 'missed' : 'planned';
      return {
        id: session.id,
        programId: 'p1',
        weekId: `week-${week.w}`,
        scheduledDate: session.date,
        orderIndex: index,
        dayType: fromEngineDayType(session.dayType),
        blocksPresent: null,
        prescribedSetCount: 0,
        dismissed: false,
        testStatus: session.isTestDay ? 'planned' : null,
        sorenessPre: null,
        rpe: null,
        legsFeel: null,
        notes: null,
        isMaximalCns: session.isMaximalCns,
        trimmedExercises: null,
        appliedModifications: null,
        shadowModifications: null,
        snapshot: session as unknown as Json,
        createdAt: '2026-09-07T00:00:00.000Z',
        updatedAt: '2026-09-07T00:00:00.000Z',
        status,
        loggedSetCount: finished ? 1 : 0,
        startedAt: null,
        markedCompleteAt: finished ? `${session.date}T19:15:00.000Z` : null,
        whoopWorkoutId: null,
      } satisfies SessionWithStatus;
    }),
  );
}

const program: Program = {
  id: 'p1',
  athleteId: 'a1',
  macroIndex: 0,
  parentProgramId: null,
  rulesetVersion: '1.0.0',
  seed: String(owner.seed),
  startDate: owner.skeleton.programStart,
  endDate: owner.skeleton.targetDate,
  status: 'active',
  snapshot: owner.skeleton as unknown as Json,
  validationReport: null,
  createdAt: '2026-09-07T00:00:00.000Z',
  updatedAt: '2026-09-07T00:00:00.000Z',
};

function model(today = FIXTURE_TODAY, states: ReadonlySet<PlanState> = new Set()) {
  return buildPlanModel({
    athlete: {
      id: 'a1',
      primaryGoal: 'vertical_jump',
      sport: 'basketball',
      trainingAgeYears: 5,
      level: 'advanced',
      daysPerWeek: 4,
      weekdays: owner.athlete.weekdays,
      isAdult: true,
      clearance: null,
      inventory: null,
      weightRoomAccess: true,
      bodyweightKg: owner.athlete.bodyweightKg,
      workingMax: {},
      inSeason: false,
      readinessPassedAt: null,
      standingReachMm: owner.athlete.standingReachMm,
      goalHeightMm: owner.athlete.goalHeightMm,
      targetDate: owner.athlete.targetDate,
      timezone: 'UTC',
      rolloverHour: 0,
      testConditionsNote: null,
      createdAt: '2026-09-07T00:00:00.000Z',
      updatedAt: '2026-09-07T00:00:00.000Z',
    },
    program,
    skeleton: owner.skeleton,
    blocks: [],
    weeks: storeWeeks(),
    sessions: storeSessions(today),
    today,
    states,
  });
}

describe('buildPlanModel on the owner fixture', () => {
  const built = model();

  it('writes the program header from the athletes own answers', () => {
    expect(built.headerLine).toBe(
      '12 weeks · 4 days/wk · Basketball · 4+ yrs · Mon 7 Sep to Sun 29 Nov',
    );
  });

  it('names the week and the block in the sticky header', () => {
    expect(built.title).toBe('Week 7 of 12 · Power block');
    expect(built.currentWeek).toBe(7);
  });

  it('draws the live adherence ladder for the running week', () => {
    expect(built.ladder).toBe('Week 7 · 2 of 4 done (50%) · finish 1 more for 75%');
  });

  it('bands the whole program, not just the weeks already built', () => {
    expect(built.segments.map((segment) => segment.span)).toEqual([
      'Strength 1-4',
      'Deload 5',
      'Power 6-10',
      'Taper 11',
      'Peak 12',
    ]);
    expect(built.strip.rows).toHaveLength(12);
  });

  it('fills future weeks from the skeleton, with no session to open', () => {
    const future = built.strip.rows.find((row) => row.w === 12);
    const training = future?.cells.filter((cell) => cell.state !== 'rest') ?? [];
    expect(training.length).toBeGreaterThan(0);
    expect(training.every((cell) => cell.sessionId === null)).toBe(true);
  });

  it('opens every session of a week that has been built', () => {
    const current = built.strip.rows.find((row) => row.w === 7);
    const training = current?.cells.filter((cell) => cell.state !== 'rest') ?? [];
    expect(training).toHaveLength(4);
    expect(training.every((cell) => cell.sessionId !== null)).toBe(true);
  });

  it('marks the test day inside the week', () => {
    const current = built.strip.rows.find((row) => row.w === 7);
    expect(current?.cells.filter((cell) => cell.isTest)).toHaveLength(1);
  });

  it('shows the outcome the current week was generated under', () => {
    expect(built.thisWeekLines[0]).toMatch(/^Week 6: 4 of 4/);
  });

  it('keeps earlier outcome lines, newest first', () => {
    expect(built.earlier.map((entry) => entry.w)).toEqual([6, 5, 4, 3, 2]);
    expect(built.earlier[2]?.line).toMatch(/Week 4/);
  });

  it('falls back to the screen name when today sits outside the program', () => {
    expect(model('2026-08-01').title).toBe('Plan');
    expect(model('2026-08-01').ladder).toBeNull();
  });

  it('reads the missed session of week 3 as missed', () => {
    const week3 = built.strip.rows.find((row) => row.w === 3);
    expect(week3?.cells.filter((cell) => cell.state === 'missed')).toHaveLength(1);
  });
});

describe('forced states', () => {
  it('labels a repeat week', () => {
    const built = model(FIXTURE_TODAY, new Set<PlanState>(['repeat']));
    expect(built.strip.rows.find((row) => row.w === 7)?.repeatLabel).toBe('Repeat of week 6');
  });

  it('turns the last finished session into a part-logged one', () => {
    const built = model(FIXTURE_TODAY, new Set<PlanState>(['not-finished']));
    const cells = built.strip.rows.flatMap((row) => row.cells);
    expect(cells.filter((cell) => cell.state === 'not_finished')).toHaveLength(1);
  });

  it('adds the in-season line', () => {
    const built = model(FIXTURE_TODAY, new Set<PlanState>(['in-season']));
    expect(built.thisWeekLines).toContain(
      'In-season: jump contacts halved, change of direction covered by games.',
    );
  });
});

describe('this week lines (defect D-23)', () => {
  it('says each sentence once, so no two siblings share a key', () => {
    const lines = model().thisWeekLines;
    expect(new Set(lines).size).toBe(lines.length);
  });

  it('still leads with the outcome the week was generated under', () => {
    const built = model(FIXTURE_TODAY, new Set<PlanState>(['in-season']));
    expect(built.thisWeekLines[0]).toMatch(/^Week 6: 4 of 4/);
    expect(new Set(built.thisWeekLines).size).toBe(built.thisWeekLines.length);
  });
});

/**
 * The speed climber. The same twelve weeks, generated through the same engine,
 * with the sport's own house rules applied
 * (`house.sc.*`, owner's athlete spec).
 */
describe('buildPlanModel on the climbing fixture', () => {
  const climber = buildClimberFixture();

  const climberProgram: Program = {
    ...program,
    startDate: climber.skeleton.programStart,
    endDate: climber.skeleton.targetDate,
    seed: String(climber.seed),
    snapshot: climber.skeleton as unknown as Json,
  };

  function climberModel(today = climber.today) {
    return buildPlanModel({
      athlete: {
        id: 'a1',
        primaryGoal: 'vertical_jump',
        sport: 'speed_climbing',
        trainingAgeYears: 5,
        level: 'advanced',
        daysPerWeek: 4,
        weekdays: climber.athlete.weekdays,
        isAdult: true,
        clearance: null,
        inventory: null,
        weightRoomAccess: true,
        bodyweightKg: climber.athlete.bodyweightKg,
        workingMax: {},
        inSeason: false,
        readinessPassedAt: null,
        standingReachMm: climber.athlete.standingReachMm,
        goalHeightMm: climber.athlete.goalHeightMm,
        targetDate: climber.athlete.targetDate,
        timezone: 'UTC',
        rolloverHour: 0,
        testConditionsNote: null,
        createdAt: '2026-09-07T00:00:00.000Z',
        updatedAt: '2026-09-07T00:00:00.000Z',
      },
      program: climberProgram,
      skeleton: climber.skeleton,
      blocks: [],
      weeks: storeWeeks(climber),
      sessions: storeSessions(today, climber),
      today,
      states: new Set<PlanState>(),
    });
  }

  const built = climberModel();

  it('names the sport in the header, because the sport picks the rules', () => {
    expect(built.headerLine).toContain('Speed climbing');
    expect(built.headerLine).toMatch(/^12 weeks · 4 days\/wk · Speed climbing · 4\+ yrs · /);
  });

  it('calls the upper day an upper power day in the week list', () => {
    const week = built.strip.rows.find((row) => row.w === 7);
    const tuesday = week?.cells.find((cell) => cell.dayType === 'Upper Strength');
    expect(tuesday?.dayTypeShort).toBe('Upper power');
    expect(tuesday?.dayTypeLabel).toBe('Upper power');
    expect(tuesday?.label).toContain('Upper power');
  });

  it('labels a future upper day from the sport, before the week is built', () => {
    const week = built.strip.rows.find((row) => row.w === 10);
    const tuesday = week?.cells.find((cell) => cell.dayType === 'Upper Strength');
    expect(tuesday?.sessionId).toBeNull();
    expect(tuesday?.dayTypeShort).toBe('Upper power');
  });

  it('carries the house rules this week applied, for the rules summary', () => {
    expect(built.appliedRuleIds).toContain('house.sc.sport_requirements');
    expect(built.appliedRuleIds).toContain('house.sc.upper_power_day');
    expect(built.appliedRuleIds).toContain('house.sc.open_hand_grip');
    expect(built.appliedRuleIds).toContain('house.sc.hard_finger_spacing');
    expect(built.appliedRuleIds).toContain('house.sc.rnt_valgus_control');
    expect(built.appliedRuleIds).toContain('house.sc.weaker_side_first');
    expect(built.appliedRuleIds).toContain('house.sc.readiness_gate');
    expect(built.appliedRuleIds.every((id) => id.startsWith('house.sc.'))).toBe(true);
  });

  it('says nothing about a readiness gate that changed nothing', () => {
    const readiness = built.thisWeekLines.filter((line) => line.includes('Readiness:'));
    expect(readiness).toEqual([]);
  });

  it('still says each sentence once', () => {
    expect(new Set(built.thisWeekLines).size).toBe(built.thisWeekLines.length);
  });
});
